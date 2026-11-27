<?php
declare(strict_types=1);
require __DIR__.'/../public/api/lib.php';
function expect(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
function rejects(callable $fn,int $status): void {try{$fn();throw new RuntimeException('Expected rejection');}catch(HttpError $e){expect($e->status===$status,'HTTP status');}}
$p=new PDO('sqlite::memory:');$p->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);letters_migrate($p,false);letters_migrate($p,false);
expect((int)$p->query('SELECT COUNT(*) FROM letter_templates')->fetchColumn()===2,'built-ins is installed once');
$template=$p->query('SELECT * FROM letter_templates WHERE id="mant-v1"')->fetch(PDO::FETCH_ASSOC);
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
expect(letter_placement((object)['x'=>40,'y'=>60,'width'=>20],$sig,$template)===['x'=>40.0,'y'=>60.0,'width'=>20.0],'placement is normalized');
rejects(fn()=>letter_placement((object)['x'=>90,'y'=>90,'width'=>50],$sig,$template),400);
rejects(fn()=>letter_placement((object)['x'=>'10','y'=>10,'width'=>20],$sig,$template),400);
$editor=letter_render($template,$fields,$sig,false,'Test',true);
expect(str_contains($editor['html'],'Предпросмотр подписи · не согласовано'),'signature editor is not an approved letter');
$print=letter_render($template,$fields,$sig,true);
expect(substr_count($print['html'],'class="letter-wrap"')===2,'one page per recipient');
expect(substr_count($print['html'],'alt="Подпись"')===2,'signature on each approved page');
expect(str_contains($print['html'],'width:297mm!important;height:210mm!important'),'exact A4 print size');
expect(substr_count($print['html'],$png)===1,'signature data is shared by the whole batch');
$batchFields=$fields;$batchFields['recipients']=array_fill(0,200,'Иванову Ивану Ивановичу');
expect(count(letter_fields((object)['fields'=>(object)$batchFields])['recipients'])===200,'200 recipients accepted');
$batch=letter_render($template,$batchFields,$sig,true);
expect(substr_count($batch['html'],'class="letter-wrap"')===200,'all 200 recipients rendered');
expect(substr_count($batch['html'],$png)===1,'large batch embeds signature only once');
rejects(fn()=>letter_fields((object)['fields'=>(object)['recipients'=>[str_repeat('а',201)]]]),400);
$untrusted='<style>p{color:red}</style><script>alert(1)</script><iframe src="/api/me"></iframe><meta http-equiv="refresh" content="0;url=/api/me"><img onerror="alert(1)" src="https://example.test/a"><p>{{recipient}}</p><p>{{body}}</p><p>{{signerRole}}</p><span>{{signature}}</span><p>{{signerName}}</p>';
$clean=letter_sanitize($untrusted);
foreach(['<script','<iframe','onerror','http-equiv','https://example.test/a'] as $bad)expect(!str_contains($clean['html'],$bad),'remove active content '.$bad);
expect(str_contains($clean['html'],'color:red'),'layout style retained');
expect(str_contains($clean['html'],'data-field="recipient"'),'marker converted');
rejects(fn()=>letter_sanitize('<h1>Без полей</h1>'),400);
rejects(fn()=>letter_fields((object)['fields'=>(object)['recipients'=>array_fill(0,201,'Тест')]]),400);
rejects(fn()=>letter_fields((object)['fields'=>(object)['orderDate'=>'2026-02-31']]),400);
rejects(fn()=>letter_signature((object)['image'=>'data:image/svg+xml;base64,xxx','signerName'=>'x','signerRole'=>'y']),400);
echo "PASS letters: migration, embedded layout, field escaping, dates, page count, signature rules, HTML sanitization and CSP\n";

// Existing per-user placements become shared once and survive later migrations.
$p->exec('DELETE FROM letter_template_signatures');
$legacy=$sig+['placements'=>['mant-v1'=>['x'=>40,'y'=>60,'width'=>20]]];
$st=$p->prepare('INSERT INTO letter_signatures VALUES (?,?)');$st->execute(['admin@example.test',json_encode($legacy)]);
letters_migrate($p,false);
$shared=json_decode($p->query("SELECT data_json FROM letter_template_signatures WHERE template_id='mant-v1'")->fetchColumn(),true);
expect($shared['placement']['width']===20,'legacy placement migrates');
$p->exec('DELETE FROM letter_signatures');letters_migrate($p,false);
expect(json_decode($p->query("SELECT data_json FROM letter_template_signatures WHERE template_id='mant-v1'")->fetchColumn(),true)===$shared,'shared migration is idempotent');
$certificate=$p->query("SELECT * FROM letter_templates WHERE id='forum-certificate-v1'")->fetch(PDO::FETCH_ASSOC);
$render=letter_render($certificate,$fields,$sig,true);
expect(substr_count($render['html'],'class="letter-wrap"')===2,'certificate batch');
expect(str_contains($render['html'],'data:image/png;base64,'),'original certificate art retained');
expect(str_contains($render['html'],'Иванову Ивану Ивановичу'),'certificate recipient');
echo "PASS shared legacy migration and certificate rendering\n";

$shared['signerName']='В. В. Шаталов';$st=$p->prepare("UPDATE letter_template_signatures SET data_json=? WHERE template_id='mant-v1'");$st->execute([json_encode($shared)]);letters_migrate($p,false);
$seed=json_decode($p->query("SELECT data_json FROM letter_template_signatures WHERE template_id='forum-certificate-v1'")->fetchColumn(),true);
expect($seed['signerName']==='В. В. Шаталов','certificate reuses MANT signer');
expect(letter_placement($seed['placement'],$seed,$certificate)!==null,'seed placement fits certificate');

$oldCertificate=str_replace('/* certificate-v2 */','',$certificate['html']);
$st=$p->prepare("UPDATE letter_templates SET html=? WHERE id='forum-certificate-v1'");$st->execute([$oldCertificate]);
letters_migrate($p,false);
expect(str_contains($p->query("SELECT html FROM letter_templates WHERE id='forum-certificate-v1'")->fetchColumn(),'/* certificate-v2 */'),'installed certificate receives the layout update');
expect(json_decode($p->query("SELECT data_json FROM letter_template_signatures WHERE template_id='forum-certificate-v1'")->fetchColumn(),true)===$seed,'layout migration preserves the shared signature');
