<?php
declare(strict_types=1);
// One-time account data changes requested by the repository owner.
// This is not an email allowlist: later role changes are never overwritten.
function apply_role_migrations(PDO $pdo, bool $mysql): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS role_migrations (id VARCHAR(120) PRIMARY KEY, applied_at VARCHAR(40) NOT NULL, outcome VARCHAR(30) NOT NULL)' . ($mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : ''));
    $id = '2026-10-18-amullakaeva-admin-v56';
    $existing = $pdo->prepare('SELECT id FROM role_migrations WHERE id = ?');
    $existing->execute([$id]);
    if ($existing->fetchColumn() !== false) return;
    $pdo->beginTransaction();
    try {
        // Claim and update in the same transaction, including concurrent requests.
        $claim = $pdo->prepare(($mysql ? 'INSERT IGNORE' : 'INSERT OR IGNORE') . ' INTO role_migrations (id, applied_at, outcome) VALUES (?, ?, ?)');
        $claim->execute([$id, gmdate('Y-m-d\TH:i:s\Z'), 'pending']);
        if ($claim->rowCount() === 1) {
            $email = 'amullakaeva97@gmail.com';
            $find = $pdo->prepare('SELECT role, active FROM users WHERE email = ?');
            $find->execute([$email]);
            $user = $find->fetch(PDO::FETCH_ASSOC);
            $outcome = !$user ? 'skipped_missing' : ((int)$user['active'] !== 1 ? 'skipped_inactive' : ($user['role'] === 'admin' ? 'already_admin' : 'promoted'));
            if ($outcome === 'promoted') {
                $update = $pdo->prepare("UPDATE users SET role = 'admin' WHERE email = ? AND active = 1");
                $update->execute([$email]);
            }
            $record = $pdo->prepare('UPDATE role_migrations SET outcome = ? WHERE id = ?');
            $record->execute([$outcome, $id]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}
