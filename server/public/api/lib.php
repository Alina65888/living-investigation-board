<?php
declare(strict_types=1);
// Living Project HQ — team server for ordinary PHP hosting (reg.ru and similar).
// Accounts with email + password, roles admin / member, the shared workspace and the team workflow.
// The static app (docs/) talks to it through /api/* — see docs/workspace-store.js.

const SESSION_DAYS = 30;
const MAX_FILE = 10 * 1024 * 1024;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW = 900;
const MEMBER_STATUSES = ['planned', 'doing', 'blocked'];
// Fields owned by the workflow (members, reviews). A stale admin save must not undo them.
const PROTECTED_FIELDS = ['status', 'progress', 'checklist', 'result', 'assignee', 'assignees', 'assigneeEmails', 'assigneeEmail', 'lead', 'contributors', 'requiresReview', 'dueDate', 'priority', 'title', 'description', 'expectedResult', 'updatedAt', 'updatedBy'];
const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;

final class HttpError extends Exception
{
    public function __construct(public int $status, string $message) { parent::__construct($message); }
}
function fail(int $status, string $message): never { throw new HttpError($status, $message); }
function send_json(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_FLAGS);
    exit;
}
function now(): string { return gmdate('Y-m-d\TH:i:s.v\Z'); }
function uid(): string { $b = random_bytes(16); $b[6] = chr(ord($b[6]) & 0x0f | 0x40); $b[8] = chr(ord($b[8]) & 0x3f | 0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4)); }
function norm_email(mixed $e): string { return mb_strtolower(trim((string)$e)); }
function clip(mixed $v, int $n): string { return mb_substr(is_scalar($v) ? (string)$v : '', 0, $n); }
function is_iso_date(mixed $v): bool { return $v === '' || $v === null || (is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) === 1); }
function split_names(mixed $s): array { return array_values(array_filter(array_map('trim', preg_split('/[;,]/', (string)$s) ?: []), fn($x) => $x !== '')); }
function ru_date(?string $s): string
{
    if (!$s) return 'без срока';
    $m = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    [$y, $mo, $d] = array_map('intval', explode('-', $s) + [0, 1, 1]);
    return $d . ' ' . ($m[$mo - 1] ?? '');
}
function prop(?object $o, string $k, mixed $default = null): mixed { return $o !== null && property_exists($o, $k) ? $o->$k : $default; }

// ---------- configuration & storage ----------
function cfg(): array
{
    static $cfg;
    if ($cfg === null) {
        $file = __DIR__ . '/config.php';
        $cfg = (is_file($file) ? require $file : []) + ['admin_email' => '', 'db' => ['driver' => 'sqlite'], 'data_dir' => ''];
    }
    return $cfg;
}
// Data lives outside the site folder when possible (~/www/living-hq-data next to ~/www/<domain>).
function data_dir(): string
{
    static $dir;
    if ($dir !== null) return $dir;
    $dir = cfg()['data_dir'] ?: (is_writable(dirname(__DIR__, 2)) ? dirname(__DIR__, 2) . '/living-hq-data' : dirname(__DIR__) . '/data');
    if (!is_dir($dir . '/files') && !mkdir($dir . '/files', 0700, true) && !is_dir($dir . '/files')) fail(500, 'Сервер не может создать папку для данных. Проверьте права на запись.');
    if (!is_file($dir . '/.htaccess')) file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    return $dir;
}
function is_mysql(): bool { return (cfg()['db']['driver'] ?? 'sqlite') === 'mysql'; }
function db(): PDO
{
    static $pdo;
    if ($pdo) return $pdo;
    $c = cfg()['db'];
    $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
    if (is_mysql()) {
        $pdo = new PDO('mysql:host=' . ($c['host'] ?? 'localhost') . ';dbname=' . $c['name'] . ';charset=utf8mb4', $c['user'], $c['password'], $opts);
    } else {
        $pdo = new PDO('sqlite:' . ($c['path'] ?? data_dir() . '/hq.sqlite'), null, null, $opts);
        $pdo->exec('PRAGMA busy_timeout = 8000');
    }
    migrate($pdo);
    return $pdo;
}
function migrate(PDO $pdo): void
{
    $long = is_mysql() ? 'LONGTEXT' : 'TEXT';
    $tables = [
        "users (email VARCHAR(191) PRIMARY KEY, name VARCHAR(200) NOT NULL, role VARCHAR(10) NOT NULL DEFAULT 'member', active INT NOT NULL DEFAULT 1, pw_hash VARCHAR(255), must_change INT NOT NULL DEFAULT 1, created_at VARCHAR(40) NOT NULL, last_login VARCHAR(40))",
        "sessions (id VARCHAR(64) PRIMARY KEY, email VARCHAR(191) NOT NULL, expires_at BIGINT NOT NULL)",
        "login_attempts (k VARCHAR(191) PRIMARY KEY, cnt INT NOT NULL, reset_at BIGINT NOT NULL)",
        "workspace (id INT PRIMARY KEY, data $long, revision INT NOT NULL)",
        // Contract-generator cards (bank details, passports): kept apart from the workspace, admins only.
        "docs (id INT PRIMARY KEY, data $long, revision INT NOT NULL)",
        "problems (id VARCHAR(64) PRIMARY KEY, title VARCHAR(400) NOT NULL, detail TEXT, task_id VARCHAR(128), author VARCHAR(191) NOT NULL, status VARCHAR(20) NOT NULL, response TEXT, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL)",
        "problem_requests (problem_id VARCHAR(64) PRIMARY KEY, reason VARCHAR(30) NOT NULL, proposed_date VARCHAR(10), original_due VARCHAR(10), decision VARCHAR(20))",
        "problem_reads (problem_id VARCHAR(64) NOT NULL, email VARCHAR(191) NOT NULL, response_version VARCHAR(64) NOT NULL, PRIMARY KEY (problem_id,email))",
        "notifications (id VARCHAR(64) PRIMARY KEY, email VARCHAR(191) NOT NULL, message TEXT NOT NULL, task_id VARCHAR(128), created_at VARCHAR(40) NOT NULL, read_at VARCHAR(40))",
        "thread (id VARCHAR(64) PRIMARY KEY, task_id VARCHAR(128) NOT NULL, author VARCHAR(191) NOT NULL, body TEXT NOT NULL, request_id VARCHAR(128) UNIQUE, created_at VARCHAR(40) NOT NULL)",
        "files (id VARCHAR(64) PRIMARY KEY, task_id VARCHAR(128) NOT NULL, name VARCHAR(255) NOT NULL, type VARCHAR(120) NOT NULL, size INT NOT NULL, author VARCHAR(191) NOT NULL, created_at VARCHAR(40) NOT NULL)",
    ];
    foreach ($tables as $t) $pdo->exec('CREATE TABLE IF NOT EXISTS ' . $t . (is_mysql() ? ' DEFAULT CHARSET=utf8mb4' : ''));
    if (!is_mysql()) foreach (['sessions(email)', 'notifications(email, created_at)', 'thread(task_id, created_at)', 'files(task_id)'] as $i => $ix) $pdo->exec("CREATE INDEX IF NOT EXISTS ix$i ON $ix");
    foreach (['workspace', 'docs'] as $t) $pdo->exec((is_mysql() ? 'INSERT IGNORE' : 'INSERT OR IGNORE') . " INTO $t (id, data, revision) VALUES (1, NULL, 0)");
}
function q(string $sql, array $args = []): PDOStatement { $st = db()->prepare($sql); $st->execute($args); return $st; }
function one(string $sql, array $args = []): ?array { $r = q($sql, $args)->fetch(); return $r === false ? null : $r; }
function all(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }

// ---------- request ----------
function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || ($_SERVER['SERVER_PORT'] ?? '') === '443';
}
function read_json(): object
{
    if (!str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) fail(415, 'Ожидался JSON');
    $body = json_decode((string)file_get_contents('php://input'));
    if (!is_object($body)) fail(400, 'Некорректный запрос');
    return $body;
}
function set_session_cookie(string $token, int $maxAge): void
{
    setcookie('lphq', $token, ['expires' => $maxAge ? time() + $maxAge : time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => is_https()]);
}

// ---------- accounts ----------
function temp_password(): string
{
    $abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    $s = '';
    for ($i = 0; $i < 10; $i++) $s .= $abc[random_int(0, strlen($abc) - 1)];
    return substr($s, 0, 5) . '-' . substr($s, 5);
}
function check_password(mixed $p): void
{
    if (!is_string($p) || mb_strlen($p) < 8) fail(400, 'Пароль должен быть не короче 8 символов');
    if (mb_strlen($p) > 200) fail(400, 'Слишком длинный пароль');
}
function set_password(string $email, string $password, bool $mustChange): void
{
    q('UPDATE users SET pw_hash = ?, must_change = ? WHERE email = ?', [password_hash($password, PASSWORD_DEFAULT), $mustChange ? 1 : 0, $email]);
}
function start_session(string $email): void
{
    $token = bin2hex(random_bytes(32));
    q('DELETE FROM sessions WHERE expires_at < ?', [time()]);
    q('INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)', [hash('sha256', $token), $email, time() + SESSION_DAYS * 86400]);
    q('UPDATE users SET last_login = ? WHERE email = ?', [now(), $email]);
    set_session_cookie($token, SESSION_DAYS * 86400);
}
function current_user(): ?array
{
    $token = $_COOKIE['lphq'] ?? '';
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) return null;
    return one('SELECT u.email, u.name, u.role, u.must_change FROM sessions s JOIN users u ON u.email = s.email WHERE s.id = ? AND s.expires_at > ? AND u.active = 1', [hash('sha256', $token), time()]);
}
function too_many_attempts(string $k): bool
{
    $r = one('SELECT cnt, reset_at FROM login_attempts WHERE k = ?', [$k]);
    return $r && (int)$r['reset_at'] > time() && (int)$r['cnt'] >= LOGIN_LIMIT;
}
function count_attempt(string $k): void
{
    $r = one('SELECT cnt, reset_at FROM login_attempts WHERE k = ?', [$k]);
    if (!$r) q('INSERT INTO login_attempts (k, cnt, reset_at) VALUES (?, 1, ?)', [$k, time() + LOGIN_WINDOW]);
    elseif ((int)$r['reset_at'] < time()) q('UPDATE login_attempts SET cnt = 1, reset_at = ? WHERE k = ?', [time() + LOGIN_WINDOW, $k]);
    else q('UPDATE login_attempts SET cnt = cnt + 1 WHERE k = ?', [$k]);
}
function public_me(array $u): array { return ['name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'mustChange' => (bool)$u['must_change']]; }
function team_list(): array
{
    return array_map(fn($u) => ['name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'active' => $u['active'] ? 1 : 0, 'pending' => $u['active'] && !$u['last_login']], all('SELECT name, email, role, active, last_login FROM users ORDER BY name'));
}
function admin_emails(): array { return array_column(all("SELECT email FROM users WHERE role = 'admin' AND active = 1"), 'email'); }
function require_admin(array $me): void { if ($me['role'] !== 'admin') fail(403, 'Действие доступно администратору'); }

// ---------- tasks & people ----------
// «Алина» in a task and the account «Алина Муллакаева» are the same person: an exact name wins,
// otherwise a first name that belongs to exactly one active account is replaced by that account's full name.
function canonical_name(string $name, array $team): string
{
    $n = mb_strtolower(trim($name));
    $first = [];
    foreach ($team as $m) {
        if (!$m['active']) continue;
        $full = mb_strtolower(trim($m['name']));
        if ($full === $n) return $m['name'];
        $first[explode(' ', $full)[0]][] = $m['name'];
    }
    return !str_contains($n, ' ') && count($first[$n] ?? []) === 1 ? $first[$n][0] : trim($name);
}
// Keeps assignee text, lead/contributors and the e-mails used for permissions in step.
function apply_people(object $t, array $team): object
{
    $co = is_array(prop($t, 'contributors')) ? array_map('strval', $t->contributors) : [];
    $joined = implode(', ', array_filter(array_merge([(string)prop($t, 'lead', '')], $co), fn($x) => $x !== ''));
    if ((string)prop($t, 'assignee', '') !== $joined) { $parts = split_names(prop($t, 'assignee', '')); $t->lead = $parts[0] ?? ''; $co = array_slice($parts, 1); }
    $names = array_values(array_unique(array_map(fn($n) => canonical_name($n, $team), array_filter(array_merge([(string)prop($t, 'lead', '')], $co), fn($x) => $x !== ''))));
    $byName = [];
    foreach ($team as $m) if ($m['active']) $byName[mb_strtolower(trim($m['name']))] = $m['email'];
    $emails = array_values(array_unique(array_filter(array_map(fn($n) => $byName[mb_strtolower($n)] ?? null, $names))));
    $t->lead = $names[0] ?? '';
    $t->contributors = array_slice($names, 1);
    $t->assignee = implode(', ', $names);
    $t->assignees = $names;
    $t->assigneeEmails = $emails;
    $t->assigneeEmail = $emails[0] ?? '';
    return $t;
}
// True when some task's people or e-mails no longer match the team (cheap check, no write).
function people_outdated(mixed $data, array $team): bool
{
    if (!is_object($data)) return false;
    foreach ((array)prop($data, 'tasks', []) as $t) {
        if (!is_object($t)) continue;
        $c = apply_people(json_decode(json_encode($t)), $team);
        if (json_encode([prop($t, 'assignee'), prop($t, 'assigneeEmails', [])]) !== json_encode([$c->assignee, $c->assigneeEmails])) return true;
    }
    return false;
}
// Re-applies the team to every task and saves only if something changed.
function relink_people(array $team): array
{
    return mutate(function ($server, $current, $next) use ($team) {
        if ($server === null) return null;
        $d = ensure_shape($server); $changed = false;
        foreach ($d->tasks as $t) {
            $before = json_encode([prop($t, 'assignee'), prop($t, 'assigneeEmails', [])]);
            apply_people($t, $team);
            if (json_encode([prop($t, 'assignee'), prop($t, 'assigneeEmails')]) !== $before) { $t->_rev = $next; $changed = true; }
        }
        return $changed ? $d : null;
    });
}
function can_edit(object $t, array $me): bool
{
    return $me['role'] === 'admin' || in_array($me['email'], (array)prop($t, 'assigneeEmails', []), true) || prop($t, 'assigneeEmail') === $me['email'] || prop($t, 'createdBy') === $me['email'];
}
function notify(array &$notes, array $emails, string $message, ?string $taskId, ?string $except): void
{
    foreach (array_unique($emails) as $e) if ($e && $e !== $except) $notes[] = [$e, $message, $taskId];
}
function flush_notes(array $notes): void
{
    foreach ($notes as [$email, $message, $taskId]) q('INSERT INTO notifications (id, email, message, task_id, created_at) VALUES (?, ?, ?, ?, ?)', [uid(), $email, clip($message, 1000), $taskId, now()]);
}
function history(string $taskId, string $author, string $body): void
{
    q('INSERT INTO thread (id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)', [uid(), $taskId, $author, clip($body, 5000), now()]);
}
function people_changes(?object $before, object $after, array &$notes, string $actor): void
{
    $was = (array)prop($before, 'assigneeEmails', []);
    $added = array_values(array_diff((array)$after->assigneeEmails, $was));
    notify($notes, $added, 'Вам назначена задача «' . prop($after, 'title', '') . '»', $after->id, $actor);
    if ($before && (string)prop($before, 'dueDate', '') !== (string)prop($after, 'dueDate', '')) notify($notes, (array)$after->assigneeEmails, 'Срок задачи «' . prop($after, 'title', '') . '» изменён: ' . ru_date(prop($after, 'dueDate')), $after->id, $actor);
}

// ---------- workspace ----------
function valid_day(string $date): bool { $d=DateTimeImmutable::createFromFormat('!Y-m-d',$date); return $d && $d->format('Y-m-d')===$date; }
function load_workspace(): array
{
    $r = one('SELECT data, revision FROM workspace WHERE id = 1');
    return [$r && $r['data'] !== null ? json_decode($r['data']) : null, (int)($r['revision'] ?? 0)];
}
// Locks the workspace row, lets $fn change the latest data and saves it with the next revision.
function mutate(callable $fn): array
{
    $pdo = db();
    if (is_mysql()) $pdo->beginTransaction(); else $pdo->exec('BEGIN IMMEDIATE');
    try {
        $r = one('SELECT data, revision FROM workspace WHERE id = 1' . (is_mysql() ? ' FOR UPDATE' : ''));
        $data = $r['data'] !== null ? json_decode($r['data']) : null;
        $rev = (int)$r['revision'];
        $out = $fn($data, $rev, $rev + 1);
        if ($out === null) { is_mysql() ? $pdo->commit() : $pdo->exec('COMMIT'); return [$data, $rev]; }
        $body = json_encode($out, JSON_FLAGS);
        if (strlen($body) > 20 * 1024 * 1024) fail(413, 'Рабочее пространство слишком большое');
        q('UPDATE workspace SET data = ?, revision = ? WHERE id = 1', [$body, $rev + 1]);
        is_mysql() ? $pdo->commit() : $pdo->exec('COMMIT');
        return [$out, $rev + 1];
    } catch (Throwable $e) {
        is_mysql() ? ($pdo->inTransaction() && $pdo->rollBack()) : $pdo->exec('ROLLBACK');
        throw $e;
    }
}
function ensure_shape(mixed $d): object
{
    $d = is_object($d) ? $d : new stdClass();
    foreach (['projects', 'tasks', 'relations', 'stages', 'milestones', 'organizations', 'archive', 'events'] as $k) if (!is_array(prop($d, $k))) $d->$k = [];
    $d->tasks = array_values(array_filter($d->tasks, 'is_object'));
    return $d;
}
function by_id(array $list): array { $m = []; foreach ($list as $x) if (is_object($x) && isset($x->id)) $m[(string)$x->id] = $x; return $m; }

function merge_admin(?object $server, object $incoming, int $base, int $current, int $next, array $team, array &$notes, array $me): object
{
    $hadArchive = is_array(prop($incoming, 'archive'));
    $hadEvents = is_array(prop($incoming, 'events'));
    $inc = ensure_shape($incoming);
    $srv = ensure_shape($server);
    $srvById = by_id($srv->tasks);
    if (!$hadEvents) $inc->events = $srv->events; // an older page without calendar events keeps them
    if ($base === $current) {
        if (!$hadArchive) $inc->archive = $srv->archive;
    } else {
        $archivedLater = [];
        foreach ($srv->archive as $a) if ((int)prop($a, '_rev', 0) > $base) $archivedLater[(string)$a->id] = true;
        $tasks = [];
        foreach ($inc->tasks as $t) {
            if (isset($archivedLater[(string)$t->id])) continue;
            $s = $srvById[(string)$t->id] ?? null;
            if ($s && (int)prop($s, '_rev', 0) > $base) {
                $t = clone $t;
                foreach (PROTECTED_FIELDS as $k) { if (property_exists($s, $k)) $t->$k = $s->$k; else unset($t->$k); }
                $t->_rev = $s->_rev;
            }
            $tasks[] = $t;
        }
        $have = by_id($tasks);
        foreach ($srv->tasks as $s) if (!isset($have[(string)$s->id]) && (int)prop($s, '_createdRev', 0) > $base) $tasks[] = $s;
        $inc->tasks = $tasks;
        $inc->archive = $srv->archive;
    }
    foreach ($inc->tasks as $t) {
        $before = $srvById[(string)prop($t, 'id', '')] ?? null;
        if (!$before) { $t->_createdRev = $next; if (!prop($t, 'createdAt')) $t->createdAt = now(); if (!prop($t, 'createdBy')) $t->createdBy = $me['email']; }
        apply_people($t, $team);
        people_changes($before, $t, $notes, $me['email']);
    }
    return $inc;
}
function merge_member(?object $server, object $incoming, int $next, array $team, array &$notes, array $me, array $admins): ?object
{
    $srv = ensure_shape($server);
    $srvById = by_id($srv->tasks);
    $projects = array_flip(array_map(fn($p) => (string)prop($p, 'id', ''), $srv->projects));
    $touched = false;
    foreach ((array)prop($incoming, 'tasks', []) as $t) {
        if (!is_object($t)) continue;
        $s = $srvById[(string)prop($t, 'id', '')] ?? null;
        if ($s) {
            if (!can_edit($s, $me)) continue;
            $changed = false;
            $st = prop($t, 'status');
            $review = prop($s, 'requiresReview') === true;
            $from = prop($s, 'status');
            if (in_array($st, ['done', 'approval'], true) && !in_array($from, ['done', 'approval'], true)) {
                // «Готово» closes the task; a task the manager wants to check (or one sent for review) goes to review instead.
                $review = $review || $st === 'approval';
                $s->status = $review ? 'approval' : 'done';
                if (!$review) $s->progress = 100;
                if ($review) notify($notes, $admins, $me['name'] . ' отметил(а) выполненной: «' . $s->title . '» — нужна проверка', $s->id, $me['email']);
                $changed = true;
            } elseif ($st !== $from && in_array($st, MEMBER_STATUSES, true) && $from !== 'approval' && ($from !== 'done' || !$review)) { $s->status = $st; $changed = true; }
            if (is_numeric(prop($t, 'progress'))) {
                $p = max(0, min(100, (int)round((float)$t->progress)));
                if ($p !== (int)prop($s, 'progress', 0)) { $s->progress = $p; $changed = true; }
            }
            if (prop($s, 'status') === 'done' && (int)prop($s, 'progress', 0) !== 100) { $s->progress = 100; $changed = true; }
            if (is_array(prop($t, 'checklist')) && is_array(prop($s, 'checklist'))) {
                foreach ($s->checklist as $i => $c) {
                    $x = $t->checklist[$i] ?? null;
                    if (is_object($x) && is_object($c) && prop($x, 'text') === prop($c, 'text') && (bool)prop($x, 'done') !== (bool)prop($c, 'done')) { $c->done = (bool)$x->done; $changed = true; }
                }
            }
            if ($changed) { $s->_rev = $next; $s->updatedAt = now(); $s->updatedBy = $me['email']; $touched = true; }
        } elseif (is_string(prop($t, 'id')) && strlen($t->id) <= 100 && trim((string)prop($t, 'title', '')) !== '') {
            $projectId = isset($projects[(string)prop($t, 'projectId', '')]) ? (string)$t->projectId : '';
            $stageId = '';
            foreach ($srv->stages as $sg) if (prop($sg, 'id') === prop($t, 'stageId') && prop($sg, 'projectId') === $projectId) $stageId = $sg->id;
            $nt = (object)[
                'id' => $t->id, 'title' => trim(clip($t->title, 300)), 'description' => clip(prop($t, 'description', ''), 5000), 'projectId' => $projectId, 'stageId' => $stageId,
                'status' => in_array(prop($t, 'status'), ['planned', 'doing'], true) ? $t->status : 'planned', 'priority' => in_array(prop($t, 'priority'), ['low', 'medium', 'high'], true) ? $t->priority : 'medium',
                'startDate' => is_iso_date(prop($t, 'startDate')) ? (string)prop($t, 'startDate', '') : '', 'dueDate' => is_iso_date(prop($t, 'dueDate')) ? (string)prop($t, 'dueDate', '') : '',
                'assignee' => $me['name'], 'lead' => $me['name'], 'contributors' => [], 'requiresReview' => false, 'createdBy' => $me['email'], 'createdAt' => now(), 'updatedAt' => now(),
                'progress' => 0, 'checklist' => [], 'inbox' => $projectId === '', '_createdRev' => $next, '_rev' => $next,
            ];
            apply_people($nt, $team);
            array_unshift($srv->tasks, $nt);
            $touched = true;
            notify($notes, $admins, $me['name'] . ' добавил(а) задачу «' . $nt->title . '»', $nt->id, $me['email']);
        }
    }
    return $touched ? $srv : null; // nothing to write: keep the revision as it is
}

// ---------- routes ----------
function handle_auth(string $path, string $method): void
{
    if ($path === '/api/me' && $method === 'GET') {
        $me = current_user();
        send_json(['team' => true, 'me' => $me ? public_me($me) : null, 'setup' => !$me && !one('SELECT 1 AS x FROM users LIMIT 1')]);
    }
    if ($method !== 'POST') fail(405, 'Метод не поддерживается');
    $body = read_json();
    if ($path === '/api/setup') {
        if (one('SELECT 1 AS x FROM users LIMIT 1')) fail(403, 'Администратор уже создан. Войдите со своим паролем.');
        $email = norm_email(prop($body, 'email'));
        $admin = norm_email(cfg()['admin_email']);
        if ($admin === '' || $email !== $admin) fail(403, 'Этот email не указан как адрес администратора в настройках сервера (api/config.php).');
        $name = trim(clip(prop($body, 'name'), 120));
        if ($name === '') fail(400, 'Укажите имя');
        check_password(prop($body, 'password'));
        q("INSERT INTO users (email, name, role, active, must_change, created_at) VALUES (?, ?, 'admin', 1, 0, ?)", [$email, $name, now()]);
        set_password($email, $body->password, false);
        start_session($email);
        send_json(['ok' => true]);
    }
    if ($path === '/api/login') {
        $email = norm_email(prop($body, 'email'));
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'local';
        if (too_many_attempts('e:' . $email) || too_many_attempts('ip:' . $ip)) fail(429, 'Слишком много попыток. Подождите 15 минут.');
        $u = one('SELECT email, pw_hash, active FROM users WHERE email = ?', [$email]);
        // Verify against a dummy hash for unknown users so timing does not reveal who has an account.
        $ok = password_verify((string)prop($body, 'password', ''), $u['pw_hash'] ?? password_hash(random_bytes(12), PASSWORD_DEFAULT)) && $u && $u['active'];
        if (!$ok) { count_attempt('e:' . $email); count_attempt('ip:' . $ip); fail(401, 'Неверный email или пароль'); }
        q('DELETE FROM login_attempts WHERE k = ?', ['e:' . $email]);
        start_session($email);
        send_json(['ok' => true]);
    }
    if ($path === '/api/logout') {
        $token = $_COOKIE['lphq'] ?? '';
        if ($token !== '') q('DELETE FROM sessions WHERE id = ?', [hash('sha256', $token)]);
        set_session_cookie('', 0);
        send_json(['ok' => true]);
    }
}

function handle_api(string $path, string $method, array $me): void
{
    if ($path === '/api/password' && $method === 'POST') {
        $body = read_json();
        $u = one('SELECT pw_hash, must_change FROM users WHERE email = ?', [$me['email']]);
        if (!$u['must_change'] && !password_verify((string)prop($body, 'current', ''), (string)$u['pw_hash'])) fail(400, 'Текущий пароль указан неверно');
        check_password(prop($body, 'next'));
        set_password($me['email'], $body->next, false);
        send_json(['ok' => true]);
    }
    if ($me['must_change']) fail(403, 'Сначала задайте новый пароль');

    if ($path === '/api/workspace') {
        if ($method === 'GET') {
            $team = team_list();
            [$data, $rev] = load_workspace();
            if (people_outdated($data, $team)) [$data, $rev] = relink_people($team); // tasks imported before the accounts existed
            send_json(['me' => public_me($me), 'team' => $team, 'revision' => $rev, 'data' => $data]);
        }
        $body = read_json();
        if (prop($body, 'action') !== 'sync' || !is_object(prop($body, 'data'))) fail(400, 'Некорректный запрос');
        $team = team_list(); $admins = admin_emails(); $notes = [];
        [$data, $rev] = mutate(function ($server, $current, $next) use ($body, $team, $admins, &$notes, $me) {
            return $me['role'] === 'admin'
                ? merge_admin($server, $body->data, (int)prop($body, 'revision', 0), $current, $next, $team, $notes, $me)
                : merge_member($server, $body->data, $next, $team, $notes, $me, $admins);
        });
        flush_notes($notes);
        send_json(['revision' => $rev, 'data' => $data]);
    }

    if ($path === '/api/docs') {
        require_admin($me);
        if ($method === 'GET') {
            $r = one('SELECT data, revision FROM docs WHERE id = 1');
            send_json(['revision' => (int)$r['revision'], 'data' => $r['data'] !== null ? json_decode($r['data']) : null]);
        }
        $body = read_json();
        if (!is_object(prop($body, 'data'))) fail(400, 'Некорректный запрос');
        $json = json_encode($body->data, JSON_FLAGS);
        if (strlen($json) > 5 * 1024 * 1024) fail(413, 'Слишком много данных');
        $st = q('UPDATE docs SET data = ?, revision = revision + 1 WHERE id = 1 AND revision = ?', [$json, (int)prop($body, 'revision', 0)]);
        if ($st->rowCount() !== 1) fail(409, 'Документы только что изменил другой руководитель. Обновите страницу, чтобы не затереть его правки.');
        send_json(['revision' => (int)one('SELECT revision FROM docs WHERE id = 1')['revision']]);
    }

    if ($path === '/api/team' && $method === 'POST') {
        require_admin($me);
        $body = read_json();
        $email = norm_email(prop($body, 'email'));
        $name = trim(clip(prop($body, 'name'), 120));
        $role = prop($body, 'role') === 'admin' ? 'admin' : 'member';
        $active = prop($body, 'active') === false ? 0 : 1;
        if (!preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/u', $email)) fail(400, 'Укажите корректный email');
        $existing = one('SELECT email, role FROM users WHERE email = ?', [$email]);
        if ($existing && $existing['role'] === 'admin' && ($role !== 'admin' || !$active) && !array_diff(admin_emails(), [$email])) fail(400, 'Нельзя убрать последнего администратора');
        $temp = null;
        if (!$existing) {
            if ($name === '') fail(400, 'Укажите имя');
            q('INSERT INTO users (email, name, role, active, must_change, created_at) VALUES (?, ?, ?, ?, 1, ?)', [$email, $name, $role, $active, now()]);
            $temp = temp_password(); set_password($email, $temp, true);
        } else {
            q('UPDATE users SET name = ?, role = ?, active = ? WHERE email = ?', [$name !== '' ? $name : one('SELECT name FROM users WHERE email = ?', [$email])['name'], $role, $active, $email]);
            if (prop($body, 'resetPassword')) { $temp = temp_password(); set_password($email, $temp, true); }
            if (prop($body, 'resetPassword') || !$active) q('DELETE FROM sessions WHERE email = ?', [$email]);
        }
        // Names in tasks follow the team: a new account picks up the tasks assigned to its name or first name.
        relink_people(team_list());
        send_json(['ok' => true, 'tempPassword' => $temp]);
    }

    if ($path === '/api/problems') {
        if ($method === 'GET') {
            $sql = 'SELECT p.*, r.reason, r.proposed_date, r.original_due, r.decision, seen.response_version AS seen_version FROM problems p LEFT JOIN problem_requests r ON r.problem_id=p.id LEFT JOIN problem_reads seen ON seen.problem_id=p.id AND seen.email=?';
            $rows = all($sql . ($me['role'] === 'admin' ? '' : ' WHERE p.author=?') . ' ORDER BY p.created_at DESC LIMIT 300', $me['role'] === 'admin' ? [$me['email']] : [$me['email'], $me['email']]);
            foreach ($rows as &$row) { $row['response_version'] = hash('sha256', ($row['response'] ?? '') . '|' . $row['updated_at'] . '|' . $row['status']); $row['response_read'] = $row['seen_version'] === $row['response_version']; unset($row['seen_version']); }
            send_json($rows);
        }
        $body = read_json();
        [, $rev] = mutate(function($server, $current, $next) use ($body, $me) {
            $notes = []; $d = ensure_shape($server); $changed = false;
            if (prop($body, 'id')) {
                $p = one('SELECT * FROM problems WHERE id=?', [(string)$body->id]) ?? fail(404, 'Вопрос не найден');
                $version = hash('sha256', ($p['response'] ?? '') . '|' . $p['updated_at'] . '|' . $p['status']);
                if (prop($body, 'action') === 'read') {
                    if ($p['author'] !== $me['email']) fail(403, 'Можно отмечать только свои ответы');
                    if (prop($body, 'version') !== $version) fail(409, 'Ответ изменился. Обновите список.');
                    q('DELETE FROM problem_reads WHERE problem_id=? AND email=?', [$p['id'],$me['email']]);
                    q('INSERT INTO problem_reads(problem_id,email,response_version) VALUES(?,?,?)', [$p['id'],$me['email'],$version]);
                    return null;
                }
                require_admin($me);
                if (prop($body, 'version') && $body->version !== $version) fail(409, 'Другой руководитель уже ответил. Обновите список.');
                $status = in_array(prop($body, 'status'), ['open','review','resolved'], true) ? $body->status : $p['status'];
                $response = trim(clip(prop($body, 'response', ''), 5000));
                $decision = prop($body, 'decision');
                if ($decision) {
                    if (!in_array($decision, ['approve','reject'], true)) fail(400, 'Неизвестное решение');
                    $r = one('SELECT * FROM problem_requests WHERE problem_id=?', [$p['id']]);
                    if (!$r || $r['reason'] !== 'deadline' || $r['decision'] || $p['status'] === 'resolved') fail(409, 'Запрос уже рассмотрен или не является переносом срока');
                    if ($decision === 'approve') {
                        $task = by_id($d->tasks)[$p['task_id']] ?? fail(409, 'Задача уже в архиве');
                        if (prop($task,'status') === 'done') fail(409, 'Задача уже завершена');
                        if ((string)prop($task,'dueDate','') !== $r['original_due']) fail(409, 'Срок уже изменился. Закройте этот запрос и уточните актуальную дату.');
                        $date = (string)prop($body,'date',$r['proposed_date']);
                        if (!valid_day($date) || (prop($task,'startDate') && $date < $task->startDate)) fail(400, 'Проверьте новую дату и дату начала задачи');
                        $task->dueDate=$date; $task->_rev=$next; $task->updatedAt=now(); $task->updatedBy=$me['email']; $changed=true;
                        $response='Срок согласован: ' . $date . ($response ? '. ' . $response : '');
                        q('INSERT INTO thread(id,task_id,author,body,created_at) VALUES(?,?,?,?,?)',[uid(),$task->id,$me['email'],$response,now()]);
                    } else { if ($response === '') fail(400, 'Объясните, почему срок не переносим'); $response='Перенос срока отклонён. ' . $response; }
                    q('UPDATE problem_requests SET decision=? WHERE problem_id=?',[$decision,$p['id']]); $status='resolved';
                }
                q('UPDATE problems SET status=?, response=?, updated_at=? WHERE id=?',[$status,$response,now(),$p['id']]);
                notify($notes,[$p['author']],'Руководитель ответил: «'.$p['title'].'»',$p['task_id'],$me['email']);
            } else {
                $title=trim(clip(prop($body,'title'),300)); if ($title==='') fail(400,'Опишите вопрос');
                $taskId=prop($body,'taskId')?clip($body->taskId,100):null;
                $reason=clip(prop($body,'reason','question'),30); $date=(string)prop($body,'proposedDate',''); $original='';
                if ($taskId && !isset(by_id($d->tasks)[$taskId])) fail(404,'Задача не найдена');
                if ($reason==='deadline') {
                    $task=by_id($d->tasks)[$taskId??'']??fail(400,'Выберите задачу для переноса срока');
                    if (!can_edit($task,$me)) fail(403,'Можно запрашивать срок только своих задач');
                    if (prop($task,'status')==='done') fail(409,'Задача уже завершена');
                    if (!valid_day($date) || (prop($task,'startDate') && $date<$task->startDate)) fail(400,'Укажите допустимую новую дату');
                    $original=(string)prop($task,'dueDate',''); if ($original===$date) fail(400,'Эта дата уже установлена');
                    if (one("SELECT p.id FROM problems p JOIN problem_requests r ON r.problem_id=p.id WHERE p.task_id=? AND p.author=? AND p.status!='resolved' AND r.reason='deadline' AND r.decision IS NULL",[$taskId,$me['email']])) fail(409,'По этой задаче уже есть запрос переноса. Дождитесь решения в разделе «Ждут моего ответа».');
                }
                $id=uid();q("INSERT INTO problems(id,title,detail,task_id,author,status,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?)",[$id,$title,clip(prop($body,'detail',''),5000),$taskId,$me['email'],now(),now()]);
                q('INSERT INTO problem_requests(problem_id,reason,proposed_date,original_due) VALUES(?,?,?,?)',[$id,$reason,$reason==='deadline'?$date:null,$original]);
                notify($notes,admin_emails(),$me['name'].' просит помощи: «'.$title.'»',$taskId,$me['email']);
            }
            flush_notes($notes); return $changed?$d:null;
        });
        send_json(['ok'=>true,'revision'=>$rev]);
    }

    if ($path === '/api/notifications') {
        if ($method === 'GET') send_json(all('SELECT id, message, task_id, created_at, read_at FROM notifications WHERE email = ? ORDER BY created_at DESC LIMIT 100', [$me['email']]));
        $body = read_json();
        if (prop($body, 'all')) q('UPDATE notifications SET read_at = ? WHERE email = ? AND read_at IS NULL', [now(), $me['email']]);
        elseif (prop($body, 'id')) q('UPDATE notifications SET read_at = ? WHERE email = ? AND id = ?', [now(), $me['email'], (string)$body->id]);
        send_json(['ok' => true]);
    }

    if ($path === '/api/task-thread') {
        if ($method === 'GET') send_json(all('SELECT author, body, created_at FROM thread WHERE task_id = ? ORDER BY created_at DESC LIMIT 200', [(string)($_GET['id'] ?? '')]));
        $body = read_json();
        $text = trim(clip(prop($body, 'text', ''), 5000));
        if ($text === '') fail(400, 'Напишите комментарий');
        [$data] = load_workspace();
        $task = by_id(ensure_shape($data)->tasks)[(string)prop($body, 'id', '')] ?? fail(404, 'Задача не найдена');
        $requestId = prop($body, 'requestId') ? clip($body->requestId, 100) : null;
        if ($requestId && one('SELECT 1 AS x FROM thread WHERE request_id = ?', [$requestId])) send_json(['ok' => true]);
        q('INSERT INTO thread (id, task_id, author, body, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [uid(), $task->id, $me['email'], $text, $requestId, now()]);
        $notes = [];
        notify($notes, array_merge((array)prop($task, 'assigneeEmails', []), $me['role'] === 'admin' ? [] : admin_emails()), $me['name'] . ' написал(а) в задаче «' . prop($task, 'title', '') . '»', $task->id, $me['email']);
        flush_notes($notes);
        send_json(['ok' => true]);
    }

    if ($path === '/api/task-files') {
        if ($method === 'GET') {
            if (isset($_GET['id'])) {
                $f = one('SELECT * FROM files WHERE id = ?', [(string)$_GET['id']]);
                $file = $f ? data_dir() . '/files/' . basename($f['id']) : '';
                if (!$f || !is_file($file)) fail(404, 'Файл не найден');
                header('Content-Type: ' . ($f['type'] ?: 'application/octet-stream'));
                header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($f['name']));
                header('Content-Length: ' . filesize($file));
                header('X-Content-Type-Options: nosniff');
                header('Cache-Control: private, no-store');
                readfile($file);
                exit;
            }
            send_json(all('SELECT id, name, size, created_at FROM files WHERE task_id = ? ORDER BY created_at', [(string)($_GET['taskId'] ?? '')]));
        }
        $up = $_FILES['file'] ?? null;
        if (!$up || is_array($up['error'])) fail(400, 'Выберите файл');
        if (in_array($up['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $up['size'] > MAX_FILE) fail(413, 'Максимальный размер файла — 10 МБ');
        if ($up['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($up['tmp_name'])) fail(400, 'Файл не загрузился');
        $taskId = clip($_POST['taskId'] ?? '', 100);
        [$data] = load_workspace();
        $task = by_id(ensure_shape($data)->tasks)[$taskId] ?? fail(404, 'Задача не найдена');
        if (!can_edit($task, $me)) fail(403, 'Можно прикладывать файлы только к своим задачам');
        $id = uid();
        if (!move_uploaded_file($up['tmp_name'], data_dir() . '/files/' . $id)) fail(500, 'Не удалось сохранить файл');
        $type = clip($up['type'] ?: 'application/octet-stream', 100);
        q('INSERT INTO files (id, task_id, name, type, size, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [$id, $taskId, clip($up['name'] ?: 'файл', 200), $type, (int)$up['size'], $me['email'], now()]);
        send_json(['id' => $id]);
    }

    if ($path === '/api/task-actions' && $method === 'POST') {
        $body = read_json(); $team = team_list(); $admins = admin_emails(); $notes = []; $log = [];
        [, $rev] = mutate(function ($server, $current, $next) use ($body, $team, $admins, &$notes, &$log, $me) {
            $notes = []; $log = [];
            $d = ensure_shape($server);
            $find = function ($id) use ($d) { foreach ($d->tasks as $t) if ((string)$t->id === (string)$id) return $t; fail(404, 'Задача не найдена'); };
            $mark = function ($t) use ($next, $me) { $t->_rev = $next; $t->updatedAt = now(); $t->updatedBy = $me['email']; };
            switch (prop($body, 'action')) {
                case 'submit':
                    $t = $find(prop($body, 'id'));
                    if (!can_edit($t, $me)) fail(403, 'Можно сдавать только свои задачи');
                    // Review only when the manager asked for it on this task or the executor chose «отправить на проверку».
                    $review = prop($t, 'requiresReview') === true || prop($body, 'review') === true;
                    $url = (string)prop($body, 'url', '');
                    $t->result = (object)['text' => clip(prop($body, 'text', ''), 5000), 'url' => preg_match('#^https?://#', $url) ? clip($url, 2000) : '', 'fileIds' => array_map(fn($x) => clip($x, 100), array_slice((array)prop($body, 'fileIds', []), 0, 10)), 'submittedAt' => now(), 'submittedBy' => $me['email'], 'review' => null];
                    $t->status = $review ? 'approval' : 'done';
                    if (!$review) $t->progress = 100;
                    $mark($t);
                    if ($review) notify($notes, $admins, $me['name'] . ' сдал(а) результат: «' . $t->title . '»', $t->id, $me['email']);
                    $log[] = [$t->id, $review ? 'Сдан результат на проверку' : 'Сдан результат, задача завершена'];
                    break;
                case 'accept':
                case 'return':
                    require_admin($me);
                    $t = $find(prop($body, 'id'));
                    $accept = $body->action === 'accept';
                    $note = clip(prop($body, 'note', ''), 3000);
                    $result = is_object(prop($t, 'result')) ? $t->result : new stdClass();
                    $result->review = (object)['decision' => $accept ? 'accept' : 'return', 'note' => $note, 'at' => now(), 'by' => $me['email']];
                    $t->result = $result;
                    $t->status = $accept ? 'done' : 'doing';
                    if ($accept) $t->progress = 100;
                    $mark($t);
                    notify($notes, (array)prop($t, 'assigneeEmails', []), ($accept ? 'Результат принят: «' : 'Задача возвращена на доработку: «') . $t->title . '»', $t->id, $me['email']);
                    $log[] = [$t->id, $accept ? 'Результат принят' . ($note !== '' ? ': ' . $note : '') : 'Возвращено на доработку: ' . $note];
                    break;
                case 'assign':
                    require_admin($me);
                    $p = is_object(prop($body, 'patch')) ? $body->patch : new stdClass();
                    foreach ((array)prop($body, 'ids', []) as $id) {
                        $t = $find($id);
                        $before = json_decode(json_encode($t));
                        foreach (['title' => 300, 'description' => 5000, 'expectedResult' => 5000] as $k => $n) if (is_string(prop($p, $k))) $t->$k = clip($p->$k, $n);
                        if (property_exists($p, 'lead')) {
                            $t->lead = clip($p->lead, 120);
                            $t->contributors = array_values(array_filter(array_map(fn($x) => clip($x, 120), (array)prop($p, 'contributors', prop($t, 'contributors', []))), fn($x) => $x !== '' && $x !== $t->lead));
                            $t->assignee = implode(', ', array_filter(array_merge([$t->lead], $t->contributors), fn($x) => $x !== ''));
                        }
                        if (property_exists($p, 'dueDate') && is_iso_date($p->dueDate)) $t->dueDate = (string)$p->dueDate;
                        if (in_array(prop($p, 'priority'), ['low', 'medium', 'high'], true)) $t->priority = $p->priority;
                        if (property_exists($p, 'requiresReview')) $t->requiresReview = (bool)$p->requiresReview;
                        apply_people($t, $team);
                        $mark($t);
                        people_changes($before, $t, $notes, $me['email']);
                    }
                    break;
                case 'archive':
                    require_admin($me);
                    $t = $find(prop($body, 'id'));
                    $d->tasks = array_values(array_filter($d->tasks, fn($x) => $x->id !== $t->id));
                    $rels = array_values(array_filter($d->relations, fn($r) => prop($r, 'sourceId') === $t->id || prop($r, 'targetId') === $t->id));
                    $d->relations = array_values(array_filter($d->relations, fn($r) => !(prop($r, 'sourceId') === $t->id || prop($r, 'targetId') === $t->id)));
                    $a = clone $t;
                    $a->archivedAt = now(); $a->archivedBy = $me['email']; $a->archivedRelations = $rels; $a->_rev = $next;
                    array_unshift($d->archive, $a);
                    $log[] = [$t->id, 'Задача перенесена в архив'];
                    break;
                case 'restore':
                    require_admin($me);
                    $a = null;
                    foreach ($d->archive as $x) if ((string)$x->id === (string)prop($body, 'id')) $a = $x;
                    if (!$a) fail(404, 'Задача не найдена в архиве');
                    $d->archive = array_values(array_filter($d->archive, fn($x) => $x->id !== $a->id));
                    $rels = (array)prop($a, 'archivedRelations', []);
                    $t = clone $a;
                    unset($t->archivedAt, $t->archivedBy, $t->archivedRelations);
                    $t->_rev = $next; $t->_createdRev = $next;
                    array_unshift($d->tasks, $t);
                    $ids = by_id($d->tasks);
                    foreach ($rels as $r) if (isset($ids[(string)prop($r, 'sourceId')], $ids[(string)prop($r, 'targetId')])) $d->relations[] = $r;
                    $log[] = [$t->id, 'Задача восстановлена из архива'];
                    break;
                default:
                    fail(400, 'Неизвестное действие');
            }
            return $d;
        });
        foreach ($log as [$taskId, $text]) history((string)$taskId, $me['email'], $text);
        flush_notes($notes);
        send_json(['ok' => true, 'revision' => $rev]);
    }
    fail(404, 'Не найдено');
}

function run(): void
{
    try {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $uri = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $at = strpos($uri, '/api/');
        $path = $at === false ? $uri : rtrim(substr($uri, $at), '/');
        // Without working rewrite rules the page calls /api/index.php/<route> directly.
        $path = preg_replace('#^/api/index\\.php(?=/|$)#', '/api', $path);
        // Browsers send Origin on cross-site requests; together with SameSite cookies this blocks CSRF.
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($method !== 'GET' && $origin !== '') {
            $o = parse_url($origin);
            $host = ($o['host'] ?? '') . (isset($o['port']) ? ':' . $o['port'] : '');
            if (strcasecmp($host, (string)($_SERVER['HTTP_HOST'] ?? '')) !== 0) fail(403, 'Запрос с другого сайта отклонён');
        }
        if (in_array($path, ['/api/me', '/api/setup', '/api/login', '/api/logout'], true)) handle_auth($path, $method);
        $me = current_user() ?? fail(401, 'Войдите в аккаунт');
        handle_api($path, $method, $me);
    } catch (HttpError $e) {
        send_json(['error' => $e->getMessage()], $e->status);
    } catch (Throwable $e) {
        error_log('Living Project HQ: ' . $e);
        // team + serverError let the page show «Сайт настраивается» with a hint instead of a blank login.
        $hint = $e instanceof PDOException
            ? (stripos($e->getMessage(), 'could not find driver') !== false
                ? 'На хостинге не включено расширение PHP pdo_sqlite. Включите его в настройках PHP для сайта.'
                : 'Сервер не смог открыть базу данных. Проверьте, что папка рядом с папкой сайта доступна для записи (living-hq-data).')
            : 'Ошибка сервера. Подробности — в журнале ошибок PHP в панели хостинга.';
        send_json(['error' => $hint, 'team' => true, 'serverError' => $hint], 500);
    }
}
