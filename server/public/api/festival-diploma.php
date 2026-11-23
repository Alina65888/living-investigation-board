<?php
declare(strict_types=1);
function festival_catalog(): array {
    $html=file_get_contents(__DIR__.'/diploma-assets/festival.html');
    if(!preg_match('~<script id="initial" type="application/json">(.*?)</script>~s',$html,$m))fail(500,'Не найден исходный комплект дипломов');
    return json_decode($m[1],true,512,JSON_THROW_ON_ERROR);
}
function festival_validate(object $b): array {
    $source=festival_catalog();$keys=array_keys($source['records'][0]);
    if(!is_array($b->records??null)||count($b->records)<1||count($b->records)>500)fail(400,'В комплекте должно быть от 1 до 500 дипломов');
    $records=[];
    foreach($b->records as $r){
        if(!is_object($r)||!in_array($r->mode??'', ['solo','group'],true))fail(400,'Некорректный получатель');
        $row=[];foreach($keys as $key){if(!isset($r->$key)||!is_string($r->$key)||mb_strlen($r->$key)>12000)fail(400,'Некорректное поле диплома');$row[$key]=$r->$key;}$records[]=$row;
    }
    $active=$b->active??0;if(!is_int($active)||$active<0||$active>=count($records))fail(400,'Некорректный номер диплома');
    $s=$b->stamp??(object)[];$image=$s->image??'';
    if(!is_string($image)||strlen($image)>3*1024*1024)fail(400,'Слишком большое изображение печати');
    $ratio=1;
    if($image!==''){
        if(!preg_match('~^data:image/png;base64,([A-Za-z0-9+/=]+)$~D',$image,$m))fail(400,'Печать должна быть изображением PNG');
        $raw=base64_decode($m[1],true);$info=$raw===false?false:@getimagesizefromstring($raw);
        if(!$info||$info[2]!==IMAGETYPE_PNG||$info[0]>1200||$info[1]>1200||!$info[1])fail(400,'Некорректное изображение печати');
        $ratio=$info[0]/$info[1];if($ratio<.5||$ratio>2)fail(400,'Неподходящие пропорции печати');
    }
    $values=[];foreach(['x','y','width'] as $k){$v=$s->$k??null;if(!is_numeric($v)||!is_finite((float)$v))fail(400,'Укажите размер и положение печати');$values[$k]=(float)$v;}
    if($values['width']<10||$values['width']>100||$values['x']<0||$values['y']<0||$values['x']+$values['width']>210.01||$values['y']+$values['width']/$ratio>297.01)fail(400,'Печать выходит за границы листа');
    return ['active'=>$active,'records'=>$records,'stamp'=>['image'=>$image,'ratio'=>$ratio]+$values];
}
// Inline both scripts so a saved HTML copy can also export PDFs offline.
function festival_editor_html(): string {
    $dir = __DIR__.'/diploma-assets/';
    $html = file_get_contents($dir.'festival.html');
    foreach (['pdf-lib.min.js', 'festival-pdf.js'] as $script) {
        $source = file_get_contents($dir.$script);
        if ($source === false) throw new RuntimeException('Не удалось загрузить редактор дипломов');
        $html = str_replace('<script src="'.$script.'"></script>', "<script>\n".$source."\n</script>", $html);
    }
    return $html;
}
function handle_festival_diploma(string $path,string $method,array $me): void {
    if(!in_array($path,['/api/festival-diploma','/api/festival-diploma-state'],true))return;
    if($me['must_change']??false)fail(403,'Сначала измените временный пароль');
    header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');header('Referrer-Policy: same-origin');
    $long=is_mysql()?'LONGTEXT':'TEXT';q("CREATE TABLE IF NOT EXISTS festival_diploma_drafts (email VARCHAR(191) PRIMARY KEY, data $long, revision INT NOT NULL DEFAULT 0)");
    q((is_mysql()?'INSERT IGNORE':'INSERT OR IGNORE').' INTO festival_diploma_drafts (email,data,revision) VALUES (?,NULL,0)',[$me['email']]);
    if($path==='/api/festival-diploma'&&$method==='GET'){
        $row=one('SELECT data,revision FROM festival_diploma_drafts WHERE email=?',[$me['email']]);
        $state=$row['data']?json_decode($row['data'],true):festival_catalog();$state['revision']=(int)$row['revision'];
        $json=json_encode($state,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
        $html=festival_editor_html();
        $html=preg_replace_callback('~(<script id="initial" type="application/json">).*?(</script>)~s',fn($m)=>$m[1].$json.$m[2],$html,1);
        header('Content-Type: text/html; charset=utf-8');
        header("Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
        echo $html;exit;
    }
    if($path==='/api/festival-diploma-state'&&$method==='POST'){
        if(($_SERVER['HTTP_X_HQ_DIPLOMA']??'')!=='1')fail(403,'Обновите страницу');
        if((int)($_SERVER['CONTENT_LENGTH']??0)>5*1024*1024)fail(413,'Слишком большой комплект дипломов');
        $b=read_json();$state=festival_validate($b);$rev=$b->revision??null;
        if(!is_int($rev)||$rev<0)fail(400,'Некорректная версия');
        $st=q('UPDATE festival_diploma_drafts SET data=?,revision=revision+1 WHERE email=? AND revision=?',[json_encode($state,JSON_FLAGS),$me['email'],$rev]);
        if($st->rowCount()!==1)fail(409,'Комплект изменён в другой вкладке. Сохраните HTML-копию текущих правок и обновите страницу');
        send_json(['revision'=>$rev+1]);
    }
    fail(405,'Действие не поддерживается');
}
