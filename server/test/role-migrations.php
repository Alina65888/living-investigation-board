<?php
declare(strict_types=1);
require __DIR__ . '/../public/api/lib.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function fixture(?int $active = 1, string $role = 'member'): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec("CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT, role TEXT, active INT, pw_hash TEXT, must_change INT, created_at TEXT, last_login TEXT)");
    $insert = $pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    if ($active !== null) $insert->execute(['amullakaeva97@gmail.com','Алина Муллакаева',$role,$active,'existing-password-hash',1,'2026-01-01','2026-10-01']);
    $insert->execute(['other@example.test','Другой участник','member',1,'other-hash',0,'2026-01-01',null]);
    $insert->execute(['boss@example.test','Администратор','admin',1,'boss-hash',0,'2026-01-01',null]);
    return $pdo;
}
function target(PDO $p): array|false { return $p->query("SELECT * FROM users WHERE email='amullakaeva97@gmail.com'")->fetch(); }
$p=fixture();$before=target($p);migrate($p);$after=target($p);
check($after['role']==='admin','target promoted by normal startup migration');
$after['role']=$before['role'];check($after===$before,'password and all other account fields retained');
check($p->query("SELECT role FROM users WHERE email='other@example.test'")->fetchColumn()==='member','other member unchanged');
check($p->query("SELECT role FROM users WHERE email='boss@example.test'")->fetchColumn()==='admin','existing admin unchanged');
check($p->query('SELECT outcome FROM role_migrations')->fetchColumn()==='promoted','outcome recorded');
$p->exec("UPDATE users SET role='member' WHERE email='amullakaeva97@gmail.com'");migrate($p);
check(target($p)['role']==='member','later demotion must survive repeated startup');
$p->exec("DELETE FROM users WHERE email='amullakaeva97@gmail.com'");
$p->exec("INSERT INTO users (email,role,active) VALUES ('amullakaeva97@gmail.com','member',1)");migrate($p);
check(target($p)['role']==='member','recreated account not automatically promoted');
$p=fixture(1,'admin');migrate($p);check($p->query('SELECT outcome FROM role_migrations')->fetchColumn()==='already_admin','existing admin no-op');
$p=fixture(0);migrate($p);check(target($p)['role']==='member'&&(int)target($p)['active']===0,'inactive account not reactivated or promoted');
$p->exec("UPDATE users SET active=1 WHERE email='amullakaeva97@gmail.com'");migrate($p);check(target($p)['role']==='member','later activation no privilege grant');
$p=fixture(null);migrate($p);check(target($p)===false,'missing account not created');
$p->exec("INSERT INTO users (email,role,active) VALUES ('amullakaeva97@gmail.com','member',1)");migrate($p);check(target($p)['role']==='member','future account does not inherit grant');
$p=fixture();$p->exec("CREATE TRIGGER reject_role BEFORE UPDATE OF role ON users BEGIN SELECT RAISE(ABORT,'test failure'); END");
try {migrate($p);throw new RuntimeException('expected failure');} catch (PDOException $e) {}
check($p->query('SELECT COUNT(*) FROM role_migrations')->fetchColumn()===0,'failed migration marker rolled back');
check(target($p)['role']==='member','failed role update rolled back');
$p->exec('DROP TRIGGER reject_role');migrate($p);check(target($p)['role']==='admin','failed migration can safely retry');
echo "PASS role migration: exact existing account, other users unchanged, no password reset, once only, inactive/missing guards, rollback\n";
