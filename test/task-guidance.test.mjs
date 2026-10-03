import test from 'node:test';
import assert from 'node:assert/strict';
import {nextStep,groupMyTasks,weekTasks} from '../docs/task-guidance.js';
test('ordinary completion remains distinct from review and returned work',()=>{
 assert.match(nextStep({status:'doing'}),/Отчёт и файлы не нужны/);
 assert.match(nextStep({status:'doing',requiresReview:true}),/комментария, ссылки или файла/);
 assert.match(nextStep({status:'doing',result:{review:{decision:'return'}}}),/Исправьте/);
 assert.match(nextStep({status:'approval'}),/Повторно отправлять.*не нужно/);
});
test('returned work is visible regardless of deadline, and each active task appears once',()=>{
 const tasks=[{id:'a',status:'doing',dueDate:'2099-01-01',result:{review:{decision:'return'}}},{id:'b',status:'approval',dueDate:'2026-01-01',result:{review:{decision:'return'}}},{id:'c',status:'doing',dueDate:''},{id:'d',status:'done'}];
 const before=structuredClone(tasks),groups=groupMyTasks(tasks,'2026-10-03','2026-10-09');
 assert.equal(groups[0][1][0].id,'a');
 assert.deepEqual(groups.flatMap(g=>g[1]).map(t=>t.id).sort(),['a','b','c']);
 assert.deepEqual(tasks,before);
});
test('seven-day overview includes boundaries, excludes done, overdue and later tasks',()=>{
 const tasks=[['later','2026-10-10'],['last','2026-10-09'],['old','2026-10-02'],['first','2026-10-03'],['none','']].map(([id,dueDate])=>({id,title:id,dueDate,status:'doing'}));
 tasks.push({id:'done',title:'done',dueDate:'2026-10-04',status:'done'});
 assert.deepEqual(weekTasks(tasks,'2026-10-03','2026-10-09').map(t=>t.id),['first','last']);
});
