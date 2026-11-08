<?php
declare(strict_types=1);
// Google credentials never enter /api/docs or the browser. No deletion/update of Drive files.
const GD_ROOT = '1e_2DfFV0jgWdwM0SIlghmu3w0IorX2qB';
const GD_REDIRECT = 'https://zadachimantckd.ru/api/google-drive-callback.php';
const GD_SCOPE = 'https://www.googleapis.com/auth/drive';
function gd_config(): array {
    $file = __DIR__ . '/google-drive.local.php';
    $local = is_file($file) ? require $file : [];
    return $local + ['client_id' => '940986091705-uh25df9fk207s8hrq0gqe6ve1gm366vt.apps.googleusercontent.com', 'client_secret' => getenv('GOOGLE_DRIVE_CLIENT_SECRET') ?: ''];
}
function gd_ready(): bool { return gd_config()['client_secret'] !== '' && extension_loaded('curl') && extension_loaded('openssl'); }
function gd_encrypt(string $plain): string {
    $iv = random_bytes(12); $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', hash('sha256', gd_config()['client_secret'], true), OPENSSL_RAW_DATA, $iv, $tag);
    if ($cipher === false) fail(500, 'Не удалось защитить подключение Google.');
    return base64_encode($iv . $tag . $cipher);
}
function gd_decrypt(string $value): string {
    $raw = base64_decode($value, true);
    if ($raw === false || strlen($raw) < 29) fail(503, 'Подключите Google Диск заново.');
    $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', hash('sha256', gd_config()['client_secret'], true), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    if ($plain === false) fail(503, 'Ключ подключения изменился. Подключите Google Диск заново.');
    return $plain;
}
function gd_get(string $key): array {
    $row = one('SELECT data FROM google_drive_state WHERE k = ?', [$key]);
    return $row ? (json_decode($row['data'], true) ?: []) : [];
}
function gd_put(string $key, array $data): void {
    q((is_mysql() ? 'INSERT INTO google_drive_state (k,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)' : 'INSERT INTO google_drive_state (k,data) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET data=excluded.data'), [$key, json_encode($data, JSON_FLAGS)]);
}
function gd_http(string $url, string $method = 'GET', ?string $body = null, array $headers = []): array {
    // All URLs are constructed here, never supplied by a caller/client.
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 45, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => $headers]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $response = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    if ($response === false) fail(502, 'Google Диск не ответил. Повторите позже.');
    if ($status < 200 || $status >= 300) {
        if ($status === 401 || $status === 400 && str_contains($response, 'invalid_grant')) fail(409, 'Доступ Google истёк. Подключите Google Диск заново.');
        if ($status === 403 || $status === 404) fail(403, 'Google не разрешил доступ. Проверьте аккаунт, права редактора, включение Drive API и разрешения приложения.');
        fail(502, 'Google не выполнил запрос (HTTP ' . $status . '). Повторите позже.');
    }
    return json_decode($response, true) ?: [];
}
function gd_token_request(array $params): array {
    $c = gd_config();
    return gd_http('https://oauth2.googleapis.com/token', 'POST', http_build_query($params + ['client_id' => $c['client_id'], 'client_secret' => $c['client_secret']]), ['Content-Type: application/x-www-form-urlencoded']);
}
function gd_token(): string {
    $c = gd_get('connection');
    if (empty($c['token'])) fail(409, 'Сначала подключите Google Диск.');
    $t = json_decode(gd_decrypt($c['token']), true);
    if (($t['expires'] ?? 0) < time() + 90) {
        $new = gd_token_request(['grant_type' => 'refresh_token', 'refresh_token' => $t['refresh_token']]);
        $t = array_merge($t, $new, ['expires' => time() + (int)($new['expires_in'] ?? 3600)]);
        $c['token'] = gd_encrypt(json_encode($t)); gd_put('connection', $c);
    }
    return $t['access_token'];
}
function gd_api(string $path, array $query = []): array {
    return gd_http('https://www.googleapis.com/drive/v3/' . $path . ($query ? '?' . http_build_query($query) : ''), 'GET', null, ['Authorization: Bearer ' . gd_token()]);
}
function gd_id(string $id): string {
    if (preg_match('~^https://drive\.google\.com/drive/(?:u/\d+/)?folders/([A-Za-z0-9_-]+)(?:[/?#].*)?$~', trim($id), $m)) $id = $m[1];
    if (!preg_match('/^[A-Za-z0-9_-]{10,200}$/', $id)) fail(400, 'Укажите ссылку на папку Google Диска.');
    return $id;
}
function gd_folder(string $id): array {
    $id = gd_id($id);
    $f = gd_api('files/' . $id, ['fields' => 'id,name,mimeType,parents,trashed,capabilities(canAddChildren)', 'supportsAllDrives' => 'true']);
    if (!empty($f['trashed']) || ($f['mimeType'] ?? '') !== 'application/vnd.google-apps.folder') fail(400, 'Выберите существующую папку, а не файл или ярлык.');
    return $f;
}
function gd_inside_root(string $id): array {
    $f = gd_folder($id); $current = $f; $seen = [];
    for ($i = 0; $i < 50; $i++) {
        if ($current['id'] === GD_ROOT) return $f;
        if (isset($seen[$current['id']]) || empty($current['parents'][0])) break;
        $seen[$current['id']] = true;
        $current = gd_folder($current['parents'][0]);
    }
    fail(400, 'Выберите папку внутри общей папки МАНТ. Ярлык не заменяет вложенную папку.');
}
function gd_binding_key(string $project, string $year): string {
    if ($project === '' || strlen($project) > 128 || !preg_match('/^\d{4}$/', $year)) fail(400, 'Укажите проект и год.');
    $docs = one('SELECT data FROM docs WHERE id=1');
    $folders = json_decode($docs['data'] ?? '{}', true)['folders'] ?? [];
    foreach ($folders as $f) if (($f['id'] ?? '') === $project && ($f['organization'] ?? '') === 'МАНТ') return 'binding:' . hash('sha256', $project . ':' . $year);
    fail(400, 'Сохраните проект МАНТ на сайте перед привязкой.');
}
function handle_google_drive(string $path, string $method, array $me): void {
    if (!str_starts_with($path, '/api/google-drive')) return;
    require_admin($me);
    if ($me['must_change']) fail(403, 'Сначала задайте новый пароль.');
    header('Cache-Control: no-store'); header('Referrer-Policy: no-referrer');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 15 * 1024 * 1024) fail(413, 'Документ слишком большой.');
    if ($method !== 'GET' && ($_SERVER['HTTP_X_HQ_DRIVE'] ?? '') !== '1') fail(403, 'Запрос отклонён. Обновите страницу.');
    $long = is_mysql() ? 'LONGTEXT' : 'TEXT';
    q("CREATE TABLE IF NOT EXISTS google_drive_state (k VARCHAR(191) PRIMARY KEY, data $long NOT NULL)");
    // Serialize refresh/upload operations without changing existing application tables.
    $lock = fopen(data_dir() . '/google-drive.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) fail(503, 'Google Диск занят. Повторите запрос.');
    try { gd_handle_locked($path, $method, $me); }
    finally { flock($lock, LOCK_UN); fclose($lock); }
}
function gd_handle_locked(string $path, string $method, array $me): void {
    if ($path === '/api/google-drive/status' && $method === 'GET') {
        $c = gd_get('connection'); $bindings = [];
        foreach (all("SELECT data FROM google_drive_state WHERE k LIKE 'binding:%'") as $r) $bindings[] = json_decode($r['data'], true);
        send_json(['configured' => gd_ready(), 'connected' => !empty($c['token']), 'account' => $c['account'] ?? '', 'root' => GD_ROOT, 'bindings' => $bindings]);
    }
    if (!gd_ready()) fail(503, 'Администратору хостинга нужно установить GOOGLE_DRIVE_CLIENT_SECRET и включить PHP cURL/OpenSSL.');
    if ($path === '/api/google-drive/connect' && $method === 'POST') {
        read_json(); $state = bin2hex(random_bytes(32)); $verifier = bin2hex(random_bytes(32));
        gd_put('oauth:' . hash('sha256', $_COOKIE['lphq']), ['state' => hash('sha256', $state), 'verifier' => $verifier, 'expires' => time() + 600]);
        send_json(['url' => 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query(['client_id' => gd_config()['client_id'], 'redirect_uri' => GD_REDIRECT, 'response_type' => 'code', 'scope' => GD_SCOPE, 'access_type' => 'offline', 'prompt' => 'consent select_account', 'state' => $state, 'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='), 'code_challenge_method' => 'S256'])]);
    }
    if ($path === '/api/google-drive-callback.php' && $method === 'GET') {
        $key = 'oauth:' . hash('sha256', $_COOKIE['lphq']); $s = gd_get($key);
        if (!$s || ($s['expires'] ?? 0) < time() || !hash_equals($s['state'], hash('sha256', (string)($_GET['state'] ?? '')))) fail(400, 'Срок подключения истёк. Вернитесь на сайт и подключите Google Диск заново.');
        q('DELETE FROM google_drive_state WHERE k=?', [$key]);
        if (isset($_GET['error'])) { header('Location: /#view=docs&drive=cancelled'); exit; }
        $t = gd_token_request(['grant_type' => 'authorization_code', 'code' => (string)($_GET['code'] ?? ''), 'redirect_uri' => GD_REDIRECT, 'code_verifier' => $s['verifier']]);
        if (empty($t['access_token']) || empty($t['refresh_token']) || !in_array(GD_SCOPE, explode(' ', $t['scope'] ?? ''), true)) fail(400, 'Google не выдал нужный доступ. Повторите подключение с разрешением доступа к Диску.');
        // Validate the selected account before replacing a previously working connection.
        $headers = ['Authorization: Bearer ' . $t['access_token']];
        $root = gd_http('https://www.googleapis.com/drive/v3/files/' . GD_ROOT . '?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true', 'GET', null, $headers);
        if (!empty($root['trashed']) || empty($root['capabilities']['canAddChildren'])) fail(403, 'У выбранного Google-аккаунта нет права добавлять файлы в папку МАНТ.');
        $about = gd_http('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', 'GET', null, $headers);
        $t['expires'] = time() + (int)($t['expires_in'] ?? 3600);
        gd_put('connection', ['token' => gd_encrypt(json_encode($t)), 'account' => $about['user']['emailAddress'] ?? '', 'connectedBy' => $me['email']]);
        header('Location: /#view=docs&drive=connected'); exit;
    }
    if ($path === '/api/google-drive/disconnect' && $method === 'POST') {
        read_json(); q("DELETE FROM google_drive_state WHERE k='connection' OR k LIKE 'oauth:%'");
        send_json(['ok' => true]);
    }
    if ($path === '/api/google-drive/bind' && $method === 'POST') {
        $b = read_json(); $project = (string)($b->project ?? ''); $year = (string)($b->year ?? ''); $key = gd_binding_key($project, $year);
        $f = gd_inside_root(gd_id((string)($b->folder ?? '')));
        if (empty($f['capabilities']['canAddChildren'])) fail(403, 'Нет прав редактора в папке проекта.');
        gd_put($key, ['project' => $project, 'year' => $year, 'folder' => $f['id'], 'name' => $f['name']]);
        send_json(['ok' => true]);
    }
    if ($path === '/api/google-drive/unbind' && $method === 'POST') {
        $b = read_json(); $key = gd_binding_key((string)($b->project ?? ''), (string)($b->year ?? ''));
        q('DELETE FROM google_drive_state WHERE k=?', [$key]); send_json(['ok' => true]);
    }
    if ($path === '/api/google-drive/upload' && $method === 'POST') {
        $b = read_json(); $key = gd_binding_key((string)($b->project ?? ''), (string)($b->year ?? '')); $binding = gd_get($key);
        if (!$binding) send_json(['skipped' => true]);
        $f = gd_inside_root($binding['folder']);
        if (empty($f['capabilities']['canAddChildren'])) fail(403, 'Нет права сохранять документы в папку проекта.');
        $name = (string)($b->name ?? ''); $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $types = ['docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xls' => 'application/vnd.ms-excel'];
        if (!isset($types[$ext]) || strlen($name) > 600 || preg_match('/[\x00-\x1f\/\\\\]/', $name)) fail(400, 'Недопустимое имя документа.');
        $raw = base64_decode((string)($b->content ?? ''), true);
        if ($raw === false || strlen($raw) === 0 || strlen($raw) > 10 * 1024 * 1024) fail(413, 'Документ должен быть размером до 10 МБ.');
        // Same bytes/name/target reuse the same Drive file even after a lost HTTP response.
        $hash = hash('sha256', $raw . $name . $binding['folder']);
        $existing = gd_api('files', ['q' => "'" . $binding['folder'] . "' in parents and trashed=false and appProperties has { key='hqDigest' and value='" . $hash . "' }", 'fields' => 'files(id,webViewLink)', 'supportsAllDrives' => 'true', 'includeItemsFromAllDrives' => 'true']);
        if (!empty($existing['files'][0])) send_json($existing['files'][0]);
        $boundary = 'hq' . bin2hex(random_bytes(16));
        $meta = json_encode(['name' => $name, 'parents' => [$binding['folder']], 'appProperties' => ['hqDigest' => $hash]], JSON_FLAGS);
        $body = "--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$meta\r\n--$boundary\r\nContent-Type: " . $types[$ext] . "\r\n\r\n$raw\r\n--$boundary--\r\n";
        $file = gd_http('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', 'POST', $body, ['Authorization: Bearer ' . gd_token(), 'Content-Type: multipart/related; boundary=' . $boundary]);
        send_json($file);
    }
    fail(404, 'Действие Google Диска не найдено.');
}
