<?php
declare(strict_types=1);
// Isolated tests: no Google, production DB, cookies or credentials.
require __DIR__ . '/../public/api/google-drive.php';
class HttpError extends Exception { public function __construct(public int $status, string $message) { parent::__construct($message); } }
function fail(int $status, string $message): never { throw new HttpError($status, $message); }
function require_admin(array $me): void { if ($me['role'] !== 'admin') fail(403, 'admin only'); }
function one(string $sql, array $args = []): ?array {
    if (str_contains($sql, 'FROM docs')) return ['data' => json_encode(['folders' => [['id' => 'mant-pearl', 'organization' => 'МАНТ'], ['id' => 'ckd', 'organization' => 'ЦКД']]])];
    return null;
}
function check(bool $condition, string $name): void { if (!$condition) throw new Exception($name); }
function rejects(callable $fn, int $status): void { try { $fn(); } catch (HttpError $e) { check($e->status === $status, 'wrong HTTP status'); return; } throw new Exception('Expected rejection'); }
putenv('GOOGLE_DRIVE_CLIENT_SECRET=synthetic-test-secret-not-a-real-credential');
$plain = '{"refresh_token":"synthetic-refresh"}';
$encrypted = gd_encrypt($plain);
check(gd_decrypt($encrypted) === $plain, 'round trip');
check(!str_contains($encrypted, 'synthetic-refresh'), 'ciphertext');
$raw = base64_decode($encrypted); $raw[28] = chr(ord($raw[28]) ^ 1);
rejects(fn() => gd_decrypt(base64_encode($raw)), 503);
putenv('GOOGLE_DRIVE_CLIENT_SECRET=another-synthetic-secret');
rejects(fn() => gd_decrypt($encrypted), 503);
check(gd_id('https://drive.google.com/drive/folders/1ABCDEFGHIJKLMN?usp=sharing') === '1ABCDEFGHIJKLMN', 'folder URL');
check(gd_id('https://drive.google.com/drive/u/0/folders/1ABCDEFGHIJKLMN') === '1ABCDEFGHIJKLMN', 'account URL');
rejects(fn() => gd_id('https://evil.example/1ABCDEFGHIJKLMN'), 400);
rejects(fn() => gd_id("1ABCDEFGHIJKLMN' or true"), 400);
check(gd_binding_key('mant-pearl', '2026') !== gd_binding_key('mant-pearl', '2027'), 'year isolation');
rejects(fn() => gd_binding_key('ckd', '2026'), 400);
rejects(fn() => gd_binding_key('unknown', '2026'), 400);
rejects(fn() => gd_binding_key('mant-pearl', '../'), 400);
foreach (['status','connect','bind','upload','disconnect'] as $route) rejects(fn() => handle_google_drive('/api/google-drive/' . $route, 'POST', ['role' => 'member']), 403);
rejects(fn() => handle_google_drive('/api/google-drive/connect', 'POST', ['role' => 'admin', 'must_change' => true]), 403);
rejects(fn() => handle_google_drive('/api/google-drive/upload', 'POST', ['role' => 'admin', 'must_change' => false]), 403);
$_COOKIE['lphq'] = str_repeat('a',64); $_GET['state'] = 'forged';
rejects(fn() => gd_handle_locked('/api/google-drive-callback.php', 'GET', ['role' => 'admin']), 400);
echo "Google Drive guards, encryption, folder IDs and project/year isolation passed.\n";
