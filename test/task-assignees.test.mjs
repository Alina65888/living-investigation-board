import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssigneeKeys,matchesAssignee,assigneeOptions} from '../docs/task-assignees.js';
const team=[{email:'a@example.test',name:'Анна Иванова',active:true},{email:'b@example.test',name:'Мария Петрова',active:true},{email:'old@example.test',name:'Бывший участник',active:false}];
test('assignee filter covers lead, co-executors and old text assignments without substring matches',()=>{
 const t={lead:'Анна Иванова',contributors:['Мария Петрова'],assigneeEmail:'a@example.test'};
 assert.ok(matchesAssignee(t,'email:a@example.test',team));assert.ok(matchesAssignee(t,'email:b@example.test',team));
 assert.ok(matchesAssignee({assignee:' Анна ; Мария Петрова '},'email:a@example.test',team));
 assert.ok(!matchesAssignee({assignee:'Аннабель'},'email:a@example.test',team));
 assert.ok(matchesAssignee({assignee:''},'unassigned',team));assert.ok(!matchesAssignee({assigneeEmails:['a@example.test']},'unassigned',team));
 assert.deepEqual(taskAssigneeKeys({assignee:'Подрядчик'},team),['name:подрядчик']);
});
test('namesakes are distinguished by email and unknown/inactive assignees remain selectable',()=>{
 const duplicate=[...team,{email:'other-a@example.test',name:'Анна Иванова',active:true}];
 const t={assignee:'Анна Иванова',assigneeEmails:['a@example.test']};
 assert.ok(matchesAssignee(t,'email:a@example.test',duplicate));assert.ok(!matchesAssignee(t,'email:other-a@example.test',duplicate));
 const options=assigneeOptions([t,{assignee:'Подрядчик'},{assigneeEmail:'old@example.test'}],duplicate);
 assert.ok(options.find(o=>o.key==='email:a@example.test').label.includes('a@example.test'));
 assert.ok(options.find(o=>o.key==='email:old@example.test').label.includes('неактивен'));assert.ok(options.some(o=>o.key==='name:подрядчик'));
 assert.equal(assigneeOptions([],team).some(o=>o.key==='email:old@example.test'),false);
});
