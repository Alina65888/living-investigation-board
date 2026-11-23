<?php
declare(strict_types=1);
require __DIR__.'/../public/api/festival-diploma.php';
class HttpError extends Exception{public function __construct(public int $status,string $message){parent::__construct($message);}}
function fail(int $status,string $message):never{throw new HttpError($status,$message);}
function check(bool $v,string $msg):void{if(!$v)throw new Exception($msg);}
function reject(callable $fn):void{try{$fn();}catch(HttpError $e){check($e->status===400,'HTTP status');return;}throw new Exception('Expected invalid input');}
$catalog=festival_catalog();check(count($catalog['records'])===24,'all 24 source diplomas');
$b=json_decode(json_encode($catalog));$b->stamp=(object)['image'=>'','x'=>125,'y'=>246,'width'=>38];
$clean=festival_validate($b);check($clean['records']===$catalog['records'],'source fields unchanged');
$b->records[0]->group='</script><script>alert(1)</script>';
$clean=festival_validate($b);$json=json_encode($clean,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT);
check(!str_contains($json,'</script>'),'embedded JSON cannot close script');
$b->stamp->image='data:image/svg+xml;base64,PHN2Zz4=';reject(fn()=>festival_validate($b));
$b->stamp->image='data:image/png;base64,aGVsbG8=';reject(fn()=>festival_validate($b));
$b->stamp->image='';$b->stamp->x=205;reject(fn()=>festival_validate($b));
$b->stamp->x=125;$b->stamp->y=295;reject(fn()=>festival_validate($b));
$b->stamp->y=246;$b->records=array_slice($b->records,0,23);reject(fn()=>festival_validate($b));
echo "Festival diploma source preservation and input guards passed.\n";
