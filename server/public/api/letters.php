<?php
declare(strict_types=1);
// Letter content is kept separate from task and contract data. Templates never run their own scripts.
const LETTER_FIELDS = ['recipient','body','order','orderNumber','orderDate','signerName','signerRole','signature'];
function letters_migrate(PDO $pdo, bool $mysql): void {
    $long=$mysql?'LONGTEXT':'TEXT';
    foreach ([
        "letter_templates (id VARCHAR(64) PRIMARY KEY, name VARCHAR(200) NOT NULL, html $long NOT NULL, defaults_json $long NOT NULL, orientation VARCHAR(20) NOT NULL, created_by VARCHAR(191) NOT NULL, created_at VARCHAR(40) NOT NULL)",
        "letters (id VARCHAR(64) PRIMARY KEY, template_id VARCHAR(64) NOT NULL, author VARCHAR(191) NOT NULL, title VARCHAR(200) NOT NULL, status VARCHAR(20) NOT NULL, fields_json $long NOT NULL, revision INT NOT NULL, approval_json $long, note TEXT NOT NULL, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL)",
        "letter_signatures (email VARCHAR(191) PRIMARY KEY, data_json $long NOT NULL)",
        "letter_events (id VARCHAR(64) PRIMARY KEY, letter_id VARCHAR(64) NOT NULL, revision INT NOT NULL, actor VARCHAR(191) NOT NULL, action VARCHAR(30) NOT NULL, note TEXT NOT NULL, created_at VARCHAR(40) NOT NULL)"
    ] as $table) $pdo->exec('CREATE TABLE IF NOT EXISTS '.$table.($mysql?' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4':''));
    $st=$pdo->prepare('SELECT id FROM letter_templates WHERE id=?');$st->execute(['mant-v1']);
    if (!$st->fetchColumn()) {
        $st=$pdo->prepare(($mysql?'INSERT IGNORE':'INSERT OR IGNORE').' INTO letter_templates VALUES (?,?,?,?,?,?,?)');
        $st->execute(['mant-v1','Благодарственное письмо МАНТ',file_get_contents(__DIR__.'/letter-assets/mant.html'),file_get_contents(__DIR__.'/letter-assets/mant.json'),'landscape','system',now()]);
    }
}
function letter_dom(string $html): DOMDocument {
    if (!class_exists('DOMDocument')) fail(503,'Для макетов включите расширение PHP DOM в настройках хостинга.');
    $d=new DOMDocument('1.0','UTF-8');$old=libxml_use_internal_errors(true);
    $d->loadHTML('<?xml encoding="UTF-8">'.$html,LIBXML_NONET|LIBXML_NOERROR|LIBXML_NOWARNING);libxml_clear_errors();libxml_use_internal_errors($old);return $d;
}
function letter_inner(DOMNode $node): string {$s='';foreach($node->childNodes as $n)$s.=$node->ownerDocument->saveHTML($n);return $s;}
function letter_nodes(DOMDocument $d,string $query): array {return iterator_to_array((new DOMXPath($d))->query($query));}
function letter_sanitize(string $html): array {
    if(strlen($html)>2*1024*1024)fail(413,'HTML-макет должен быть не больше 2 МБ.');
    $d=letter_dom($html);
    // Import the supplied standalone editor without evaluating its JavaScript.
    $tpl=letter_nodes($d,'//template[@id="tpl"]')[0]??null;
    if($tpl){
        $styles='';foreach($d->getElementsByTagName('style') as $s)$styles.='<style>'.$s->textContent.'</style>';
        $fragment=letter_inner($tpl);
        if(preg_match('/const\s+LOGO\s*=\s*"(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+\/=]+)"/',$html,$m)){
            $fragment=preg_replace('/data-logo=""/','data-logo="" src="'.$m[1].'"',$fragment);
        }
        $d=letter_dom('<html><head>'.$styles.'</head><body>'.$fragment.'</body></html>');
    }
    foreach(letter_nodes($d,'//*[contains(concat(" ",normalize-space(@class)," ")," js-name ")]') as $n)$n->setAttribute('data-field','recipient');
    foreach(letter_nodes($d,'//*[contains(concat(" ",normalize-space(@class)," ")," js-order ")]') as $n)$n->setAttribute('data-field','order');
    if($tpl){
        $ps=letter_nodes($d,'//body//p');if(count($ps)===1)$ps[0]->setAttribute('data-field','body');
        foreach(letter_nodes($d,'//div[contains(@style,"grid-template-columns: 1fr 220px 1fr")]') as $row){
            $cols=[];foreach($row->childNodes as $n)if($n instanceof DOMElement)$cols[]=$n;
            if(count($cols)===3){$cols[0]->setAttribute('data-field','signerRole');$cols[1]->setAttribute('data-field','signature');$cols[1]->setAttribute('style','height:55px;border-bottom:1px solid;display:flex;align-items:center;justify-content:center');$cols[2]->setAttribute('data-field','signerName');}
        }
    }
    $tags=explode(' ','html head body title style div span p h1 h2 h3 h4 h5 h6 br hr b strong i em u small sup sub ul ol li table thead tbody tfoot tr td th colgroup col img svg g defs pattern path rect circle ellipse line polyline polygon text tspan use image');
    $attrs=explode(' ','class id style title lang dir role aria-hidden aria-label width height viewbox preserveaspectratio x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width opacity transform patternunits patterntransform colspan rowspan align valign data-field');
    foreach(array_reverse(letter_nodes($d,'//*')) as $n){
        if(!in_array(strtolower($n->tagName),$tags,true)){$n->parentNode?->removeChild($n);continue;}
        foreach(iterator_to_array($n->attributes) as $a){$key=strtolower($a->name);$v=trim($a->value);
            $image=($key==='src'&&strtolower($n->tagName)==='img')||in_array($key,['href','xlink:href'],true);
            if($image){if(!preg_match('~^(?:#[a-zA-Z0-9_-]+|data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$~D',$v))$n->removeAttribute($a->name);}
            elseif(!in_array($key,$attrs,true)||($key==='data-field'&&!in_array($v,LETTER_FIELDS,true)))$n->removeAttribute($a->name);
        }
    }
    // Plain markers can be used in any new HTML layout; markers in attributes are not evaluated.
    foreach(letter_nodes($d,'//body//text()[not(ancestor::style)]') as $node){
        if(!preg_match('/\{\{('.implode('|',LETTER_FIELDS).')\}\}/',$node->textContent))continue;
        $parts=preg_split('/\{\{('.implode('|',LETTER_FIELDS).')\}\}/',$node->textContent,-1,PREG_SPLIT_DELIM_CAPTURE);
        foreach($parts as $i=>$part){$n=$i%2?$d->createElement('span'):$d->createTextNode($part);if($i%2)$n->setAttribute('data-field',$part);$node->parentNode->insertBefore($n,$node);}$node->parentNode->removeChild($node);
    }
    $fields=[];$defaults=[];foreach(letter_nodes($d,'//*[@data-field]') as $n){$key=$n->getAttribute('data-field');$fields[]=$key;if(in_array($key,['body','signerName','signerRole'],true))$defaults[$key]=trim($n->textContent);if($key==='signature')while($n->firstChild)$n->removeChild($n->firstChild);}
    foreach(['recipient','signature','signerName','signerRole'] as $key)if(!in_array($key,$fields,true))fail(400,'В макете не найдено поле {{'.$key.'}}. Добавьте его в HTML или используйте образец МАНТ.');
    $styles='';foreach($d->getElementsByTagName('style') as $s)$styles.='<style>'.$s->textContent.'</style>';
    $body=$d->getElementsByTagName('body')->item(0);if(!$body)fail(400,'В HTML нет содержимого письма.');
    $clean=$styles.letter_inner($body);if(strlen($clean)>3*1024*1024)fail(413,'После обработки макет слишком большой. Уменьшите встроенные изображения.');
    return ['html'=>$clean,'defaults'=>$defaults,'fields'=>array_values(array_unique($fields))];
}
function letter_template(string $id): array {return one('SELECT * FROM letter_templates WHERE id=?',[$id])??fail(404,'Макет не найден');}
function letter_access(array $me,string $id): array {$r=one('SELECT * FROM letters WHERE id=?',[$id])??fail(404,'Письмо не найдено');if($me['role']!=='admin'&&$r['author']!==$me['email'])fail(403,'Письмо доступно автору и администратору');return $r;}
function letter_fields(object $body): array {
    $x=prop($body,'fields');if(!is_object($x))fail(400,'Заполните поля письма');
    $names=prop($x,'recipients',[]);if(!is_array($names)||count($names)>50)fail(400,'В одном комплекте может быть до 50 получателей.');
    $names=array_values(array_filter(array_map(fn($n)=>trim(clip($n,200)),$names),fn($n)=>$n!==''));
    $date=clip(prop($x,'orderDate',''),10);if($date!==''&&(!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$date)||!checkdate((int)substr($date,5,2),(int)substr($date,8,2),(int)substr($date,0,4))))fail(400,'Проверьте дату приказа');
    return ['recipients'=>$names,'body'=>clip(prop($x,'body',''),2200),'orderNumber'=>clip(prop($x,'orderNumber',''),80),'orderDate'=>$date];
}
function letter_public(array $r): array {
    $r['fields']=json_decode($r['fields_json'],true);$r['revision']=(int)$r['revision'];$approval=json_decode($r['approval_json']??'null',true);
    $r['approval']=$approval?array_diff_key($approval,['image'=>true]):null;unset($r['fields_json'],$r['approval_json']);return $r;
}
function letter_signature(object $b): array {
    $image=(string)prop($b,'image','');$name=trim(clip(prop($b,'signerName',''),120));$role=trim(clip(prop($b,'signerRole',''),160));
    if(!$name||!$role)fail(400,'Укажите имя и должность подписанта');
    if(strlen($image)>1400000||!preg_match('~^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$~D',$image,$m))fail(400,'Загрузите подпись PNG или JPEG размером до 1 МБ.');
    $bytes=base64_decode($m[2],true);$size=$bytes?@getimagesizefromstring($bytes):false;
    if(!$size||!in_array($size[2],[IMAGETYPE_PNG,IMAGETYPE_JPEG],true)||$size[0]>4000||$size[1]>4000)fail(400,'Не удалось прочитать изображение подписи. Максимальная сторона: 4000 пикселей.');
    return ['image'=>$image,'signerName'=>$name,'signerRole'=>$role];
}
function letter_change(array $me,object $b): array {
    $action=(string)prop($b,'action','');$pdo=db();$pdo->beginTransaction();
    try {
        $r=letter_access($me,(string)prop($b,'id',''));
        if((int)prop($b,'revision',-1)!==(int)$r['revision'])fail(409,'Письмо уже изменилось. Откройте его заново перед действием.');
        $status=$r['status'];$approval=$r['approval_json'];$fields=$r['fields_json'];$note=$r['note'];$title=$r['title'];$recipients=[];
        if($action==='save'){
            if(!in_array($status,['draft','returned'],true))fail(409,'Сначала верните письмо в черновики. Согласованная версия защищена от правок.');
            $fields=json_encode(letter_fields($b),JSON_FLAGS);$title=trim(clip(prop($b,'title',''),200))?:'Благодарственное письмо';$approval=null;
        } elseif($action==='submit'){
            if(!in_array($status,['draft','returned'],true))fail(409,'Письмо уже отправлено');
            $f=json_decode($fields,true);if(!$f['recipients'])fail(400,'Добавьте хотя бы одного получателя');
            $status='pending';$note='';$approval=null;$recipients=admin_emails();
        } elseif($action==='approve'){
            require_admin($me);if($status!=='pending')fail(409,'На согласовании уже другая версия письма');
            $sig=one('SELECT data_json FROM letter_signatures WHERE email=?',[$me['email']]);if(!$sig)fail(400,'Сначала загрузите изображение подписи и укажите подписанта');
            if(!hash_equals(hash('sha256',$sig['data_json']),(string)prop($b,'signatureVersion','')))fail(409,'Подпись изменилась. Проверьте ее и согласуйте письмо заново.');
            $snapshot=json_decode($sig['data_json'],true)+['approvedBy'=>$me['email'],'approvedName'=>$me['name'],'approvedAt'=>now(),'signedRevision'=>(int)$r['revision']+1];
            $approval=json_encode($snapshot,JSON_FLAGS);$status='approved';$note='';$recipients=[$r['author']];
        } elseif($action==='return'){
            require_admin($me);if($status!=='pending')fail(409,'Письмо сейчас не на согласовании');$note=trim(clip(prop($b,'note',''),2000));if(!$note)fail(400,'Напишите, что нужно исправить');$status='returned';$approval=null;$recipients=[$r['author']];
        } elseif($action==='revise'){
            if(!in_array($status,['pending','approved'],true))fail(409,'Письмо уже можно редактировать');$status='draft';$approval=null;$note='';$recipients=admin_emails();
        } else fail(400,'Неизвестное действие');
        $revision=(int)$r['revision']+1;
        $st=$pdo->prepare('UPDATE letters SET title=?,status=?,fields_json=?,approval_json=?,note=?,revision=?,updated_at=? WHERE id=? AND revision=?');
        $st->execute([$title,$status,$fields,$approval,$note,$revision,now(),$r['id'],$r['revision']]);if($st->rowCount()!==1)fail(409,'Письмо изменилось. Откройте его заново.');
        q('INSERT INTO letter_events VALUES (?,?,?,?,?,?,?)',[uid(),$r['id'],$revision,$me['email'],$action,$action==='return'?$note:'',now()]);
        $labels=['submit'=>'На согласовании','approve'=>'Согласовано и подписано','return'=>'Нужны правки','revise'=>'Возвращено в черновики'];
        foreach(array_unique($recipients) as $email)if($email!==$me['email'])flush_notes([[$email,($labels[$action]??'Обновлено').': благодарственное письмо «'.$title.'». Меню → Благодарственные письма.',null]]);
        $pdo->commit();return letter_public(letter_access($me,$r['id']));
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
}
function letter_order(array $f): string {
    $months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];$date=$f['orderDate']??'';
    $date=$date?('«'.substr($date,8,2).'» '.$months[(int)substr($date,5,2)-1].' '.substr($date,0,4).' г.'):'«____» ________________ 20___ г.';
    return 'Приказ № '.(($f['orderNumber']??'')?:'_____').' от '.$date;
}
function letter_render(array $template,array $fields,?array $approval,bool $print=false,string $title='Благодарственное письмо'): array {
    $nonce=base64_encode(random_bytes(18));
    $csp="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-$nonce'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; sandbox allow-scripts allow-modals";
    $d=letter_dom($template['html']);$css='';foreach(iterator_to_array($d->getElementsByTagName('style')) as $s){$css.=$d->saveHTML($s);$s->parentNode->removeChild($s);}
    $body=$d->getElementsByTagName('body')->item(0);$fragment=$body?letter_inner($body):'';
    $defaults=json_decode($template['defaults_json'],true);$names=$fields['recipients']?:['Имя Отчество Фамилия'];if(!$print)$names=array_slice($names,0,1);
    $pages='';foreach($names as $index=>$name){
        $page=letter_dom('<html><body>'.$fragment.'</body></html>');
        $values=['recipient'=>$name,'body'=>$fields['body'],'order'=>letter_order($fields),'orderNumber'=>$fields['orderNumber'],'orderDate'=>$fields['orderDate'],'signerName'=>$approval['signerName']??$defaults['signerName']??'','signerRole'=>$approval['signerRole']??$defaults['signerRole']??''];
        foreach(letter_nodes($page,'//*[@data-field]') as $n){$key=$n->getAttribute('data-field');while($n->firstChild)$n->removeChild($n->firstChild);
            if($key==='signature'){if($approval){$im=$page->createElement('img');$im->setAttribute('src',$approval['image']);$im->setAttribute('alt','Подпись');$im->setAttribute('style','max-width:100%;max-height:70px;object-fit:contain');$n->appendChild($im);}}
            else $n->appendChild($page->createTextNode($values[$key]??''));
        }
        $pages.='<div class="letter-wrap"><div class="letter-paper">'.letter_inner($page->getElementsByTagName('body')->item(0)).(!$approval?'<div class="letter-draft">Черновик · без подписи</div>':'').'</div></div>';
        if(strlen($pages)>24*1024*1024)fail(413,'Комплект слишком большой. Разделите получателей на несколько писем.');
    }
    $land=$template['orientation']==='landscape';$w=$land?1123:794;$h=$land?794:1123;$pageSize=$land?'297mm 210mm':'210mm 297mm';$pageW=$land?'297mm':'210mm';$pageH=$land?'210mm':'297mm';
    $metaCsp=str_replace('; sandbox allow-scripts allow-modals','',$csp);
    $head='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="'.htmlspecialchars($metaCsp,ENT_QUOTES).'">';
    $html=$head.'<title>'.htmlspecialchars($title).'</title>'.$css.'<style>html,body{margin:0;background:#e9e6df} .letter-wrap{position:relative;margin:16px auto;overflow:hidden;background:white} .letter-paper{position:absolute;left:0;top:0;width:'.$w.'px;height:'.$h.'px;transform-origin:0 0;overflow:hidden} .letter-draft{position:absolute;bottom:6px;left:0;right:0;text-align:center;font:12px Arial;color:#6c6257;z-index:2147483647} [data-field="recipient"]{max-width:94%;white-space:nowrap} [data-field="body"]{white-space:pre-line} [data-field="signature"] img{max-width:100%;max-height:70px} #letter-tools{padding:14px;font:15px/1.5 Arial;background:#fff;position:sticky;top:0;z-index:2147483647} #letter-tools button{font:inherit;padding:10px 16px;cursor:pointer} @page{size:'.$pageSize.';margin:0} @media print{html,body{background:white}#letter-tools{display:none!important}.letter-wrap{width:'.$pageW.'!important;height:'.$pageH.'!important;margin:0;break-after:page;page-break-after:always}.letter-wrap:last-child{break-after:auto;page-break-after:auto}.letter-paper{transform:none!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>'.($print?'<div id="letter-tools"><button id="letter-print">Печать / сохранить в PDF</button> А4 · '.($land?'альбомная':'книжная').' · поля «Нет» · масштаб 100% · фоновая графика включена<span id="letter-overflow" role="alert"></span></div>':'').$pages;
    $js='const w='.$w.',h='.$h.';'.<<<'JS'
let fits=true,ready=false;
function fit(){
 document.querySelectorAll('[data-field=recipient]').forEach(n=>{let size=parseFloat(getComputedStyle(n).fontSize);while(n.scrollWidth>Math.min(w-100,n.clientWidth)&&size>15)n.style.fontSize=(--size)+'px';if(n.scrollWidth>Math.min(w-100,n.clientWidth)){n.style.whiteSpace='normal';n.style.overflowWrap='anywhere'}});
 document.querySelectorAll('.letter-wrap').forEach(n=>{const k=Math.min(1,Math.max(.15,(innerWidth-24)/w));n.style.width=w*k+'px';n.style.height=h*k+'px';n.firstElementChild.style.transform='scale('+k+')'});
 fits=[...document.querySelectorAll('.letter-paper')].every(p=>{const r=p.getBoundingClientRect();return [...p.querySelectorAll('[data-field]')].every(n=>{const b=n.getBoundingClientRect();return b.bottom<=r.bottom+2&&b.top>=r.top-2&&b.right<=r.right+2&&b.left>=r.left-2})});
 const note=document.getElementById('letter-overflow'),btn=document.getElementById('letter-print');if(note)note.textContent=fits?'':' Текст не помещается на лист. Вернитесь к письму, сократите текст и согласуйте правки.';if(btn)btn.disabled=!fits;
 if(parent!==window)parent.postMessage({type:'letter-layout',fits,ready},'*');
}
window.addEventListener('resize',fit);document.fonts.ready.then(()=>{ready=true;fit()});fit();
document.getElementById('letter-print')?.addEventListener('click',async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));fit();if(fits)window.print()});
JS;
    $html.='<script nonce="'.$nonce.'">'.$js.'</script></body></html>';return ['html'=>$html,'csp'=>$csp];
}
function handle_letters(string $path,string $method,array $me): void {
    if(!str_starts_with($path,'/api/letter'))return;
    if($me['mustChange']??false)fail(403,'Сначала измените временный пароль');
    letters_migrate(db(),is_mysql());
    if($path==='/api/letter-templates'){
        if($method==='GET'){
            $out=[];foreach(all('SELECT id,name,defaults_json,orientation,created_at,created_by FROM letter_templates ORDER BY created_at DESC') as $t){$t['defaults']=json_decode($t['defaults_json'],true);unset($t['defaults_json']);$out[]=$t;}send_json($out);
        }
        if($method==='POST'){require_admin($me);$b=read_json();$name=trim(clip(prop($b,'name'),200));if(!$name)fail(400,'Назовите макет');$clean=letter_sanitize((string)prop($b,'html',''));$id=uid();$orientation=prop($b,'orientation')==='portrait'?'portrait':'landscape';q('INSERT INTO letter_templates VALUES (?,?,?,?,?,?,?)',[$id,$name,$clean['html'],json_encode($clean['defaults']+['_fields'=>$clean['fields']],JSON_FLAGS),$orientation,$me['email'],now()]);send_json(['id'=>$id]);}
    }
    if($path==='/api/letter-signature'){
        require_admin($me);if($method==='GET'){$s=one('SELECT data_json FROM letter_signatures WHERE email=?',[$me['email']]);send_json($s?(json_decode($s['data_json'],true)+['version'=>hash('sha256',$s['data_json'])]):null);}
        if($method==='POST'){$sig=letter_signature(read_json());$pdo=db();$pdo->beginTransaction();try{q('DELETE FROM letter_signatures WHERE email=?',[$me['email']]);q('INSERT INTO letter_signatures VALUES (?,?)',[$me['email'],json_encode($sig,JSON_FLAGS)]);$pdo->commit();}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}send_json(['ok'=>true,'version'=>hash('sha256',json_encode($sig,JSON_FLAGS))]);}
    }
    if($path==='/api/letters'){
        if($method==='GET'){
            $id=(string)($_GET['id']??'');if($id){$r=letter_access($me,$id);$out=letter_public($r);$out['history']=all('SELECT actor,action,note,created_at,revision FROM letter_events WHERE letter_id=? ORDER BY revision DESC',[$id]);send_json($out);}
            $rows=all('SELECT id,template_id,author,title,status,fields_json,revision,note,created_at,updated_at FROM letters'.($me['role']==='admin'?'':' WHERE author=?').' ORDER BY updated_at DESC',$me['role']==='admin'?[]:[$me['email']]);send_json(array_map('letter_public',$rows));
        }
        if($method==='POST'){$b=read_json();$action=prop($b,'action');if($action==='create'){
            $t=letter_template((string)prop($b,'templateId'));$id=uid();$defaults=json_decode($t['defaults_json'],true);$fields=['recipients'=>[],'body'=>$defaults['body']??'','orderNumber'=>'','orderDate'=>''];
            q('INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?,?)',[$id,$t['id'],$me['email'],$t['name'],'draft',json_encode($fields,JSON_FLAGS),1,null,'',now(),now()]);
            send_json(letter_public(letter_access($me,$id)));
        }send_json(letter_change($me,$b));}
    }
    if($path==='/api/letter-preview'&&$method==='POST'){
        $b=read_json();$t=letter_template((string)prop($b,'templateId'));$f=letter_fields($b);$out=letter_render($t,$f,null);send_json(['html'=>$out['html']]);
    }
    if($path==='/api/letter-render'&&$method==='GET'){
        $r=letter_access($me,(string)($_GET['id']??''));if((int)($_GET['revision']??-1)!==(int)$r['revision'])fail(409,'Версия письма изменилась. Откройте письмо заново.');
        $print=($_GET['mode']??'')==='print';if($print&&$r['status']!=='approved')fail(403,'Печать с подписью доступна после согласования администратором');
        $a=$r['status']==='approved'?json_decode($r['approval_json'],true):null;
        $out=letter_render(letter_template($r['template_id']),json_decode($r['fields_json'],true),$a,$print,$r['title']);
        header('Content-Type: text/html; charset=utf-8');header('Cache-Control: private, no-store');header('Content-Security-Policy: '.$out['csp']);header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');echo $out['html'];exit;
    }
    fail(405,'Действие не поддерживается');
}
