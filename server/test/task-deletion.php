<?php
declare(strict_types=1);
require __DIR__.'/../public/api/lib.php';
function check(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
$admin=['email'=>'boss@example.test','name'=>'Руководитель','role'=>'admin'];
$member=['email'=>'member@example.test','name'=>'Исполнитель','role'=>'member'];
$task=(object)['id'=>'delete-test','title'=>'Удаляемая задача','createdBy'=>$member['email'],'_createdRev'=>1,'status'=>'planned'];
$keep=(object)['id'=>'keep','title'=>'Сохранить','_createdRev'=>1,'status'=>'planned'];
$server=ensure_shape((object)['tasks'=>[$task,$keep],'relations'=>[(object)['id'=>'rel','sourceId'=>'delete-test','targetId'=>'keep']]]);
$incoming=json_decode(json_encode($server));$incoming->tasks=[$keep];$incoming->relations=[];$notes=[];
$deleted=merge_admin($server,$incoming,1,1,2,[],$notes,$admin);
check(count($deleted->tasks)===1,'task removed');check(count($deleted->relations)===0,'relations removed');
check($deleted->_deletedTasks->{'delete-test'}===2,'server records deletion revision');
$stale=merge_admin($deleted,json_decode(json_encode($server)),1,2,3,[],$notes,$admin);
check(count($stale->tasks)===1&&count($stale->relations)===0,'stale administrator cannot restore removed task or links');
$staleMember=merge_member($deleted,json_decode(json_encode($server)),3,[],$notes,$member,[$admin['email']]);
check($staleMember===null||count($staleMember->tasks)===1,'stale member cannot recreate a deleted task as new');
$undo=merge_admin($deleted,json_decode(json_encode($server)),2,2,3,[],$notes,$admin);
check(count($undo->tasks)===2&&count($undo->relations)===1,'explicit current-revision Undo restores task and links');
check(!isset($undo->_deletedTasks->{'delete-test'}),'Undo clears the tombstone');
echo "PASS task deletion: task, links, stale admin/member saves, explicit undo\n";
