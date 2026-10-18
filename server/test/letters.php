<?php
declare(strict_types=1);
require __DIR__.'/../public/api/lib.php';
function expect(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
function rejects(callable $fn,int $status): void {try{$fn();throw new RuntimeException('Expected rejection');}catch(HttpError $e){expect($e->status===$status,'HTTP status');}}
$p=new PDO('sqlite::memory:');$p->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);letters_migrate($p,false);letters_migrate($p,false);
expect((int)$p->query('SELECT COUNT(*) FROM letter_templates')->fetchColumn()===1,'built-in is installed once');
$template=$p->query('SELECT * FROM letter_templates')->fetch(PDO::FETCH_ASSOC);
$fields=letter_fields((object)['fields'=>(object)['recipients'=>['Иванову Ивану Ивановичу','Петровой Анне Сергеевне'],'body'=>'За участие <b>в проекте</b>','orderNumber'=>'15','orderDate'=>'2026-03-02']]);
expect(letter_order($fields)==='Приказ № 15 от «02» марта 2026 г.','padded Russian date');
$preview=letter_render($template,$fields,null);
expect(str_contains($preview['html'],'&lt;b&gt;в проекте&lt;/b&gt;'),'text must never become markup');
expect(!str_contains($preview['html'],'alt="Подпись"'),'draft without signature');
expect(str_contains($preview['csp'],'sandbox allow-scripts allow-modals'),'opaque sandbox');
expect(!str_contains($preview['csp'],'allow-same-origin'),'no access to parent origin');
expect(str_contains($preview['csp'],"default-src 'none'"),'no external requests');
expect(str_contains($preview['html'],'data:font/woff2'),'embedded fonts retained');
expect(str_contains($preview['html'],'--letter-logo'),'built-in logo retained');
$png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=';
$sig=letter_signature((object)['image'=>$png,'signerName'=>'Тест','signerRole'=>'Председатель']);
$print=letter_render($template,$fields,$sig,true);
expect(substr_count($print['html'],'class="letter-wrap"')===2,'one page per recipient');
expect(substr_count($print['html'],'alt="Подпись"')===2,'signature on each approved page');
expect(str_contains($print['html'],'width:297mm!important;height:210mm!important'),'exact A4 print size');
$untrusted='<style>p{color:red}</style><script>alert(1)</script><iframe src="/api/me"></iframe><meta http-equiv="refresh" content="0;url=/api/me"><img onerror="alert(1)" src="https://example.test/a"><p>{{recipient}}</p><p>{{body}}</p><p>{{signerRole}}</p><span>{{signature}}</span><p>{{signerName}}</p>';
$clean=letter_sanitize($untrusted);
foreach(['<script','<iframe','onerror','http-equiv','https://example.test/a'] as $bad)expect(!str_contains($clean['html'],$bad),'remove active content '.$bad);
expect(str_contains($clean['html'],'color:red'),'layout style retained');
expect(str_contains($clean['html'],'data-field="recipient"'),'marker converted');
rejects(fn()=>letter_sanitize('<h1>Без полей</h1>'),400);
rejects(fn()=>letter_fields((object)['fields'=>(object)['recipients'=>array_fill(0,51,'Тест')]]),400);
rejects(fn()=>letter_fields((object)['fields'=>(object)['orderDate'=>'2026-02-31']]),400);
rejects(fn()=>letter_signature((object)['image'=>'data:image/svg+xml;base64,xxx','signerName'=>'x','signerRole'=>'y']),400);
echo "PASS letters: migration, embedded layout, field escaping, dates, page count, signature rules, HTML sanitization and CSP\n";
