import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyTasks,captureSurface,restoreSurface,disclosureKey} from '../docs/journey-state.js';
test('daily tasks include other projects and overdue work even after navigating a project',()=>{
 const tasks=[{id:'a',projectId:'p1',title:'Договор',status:'doing'},{id:'b',projectId:'p2',title:'Позвонить',status:'doing',dueDate:'2020-01-01'}];
 assert.equal(dailyTasks(tasks,[]).length,2);
 assert.deepEqual(dailyTasks(tasks,[{id:'p2',name:'Форум'}],'фОРУМ').map(t=>t.id),['b']);
 assert.equal(dailyTasks(tasks,[],'несуществующая задача').length,0);
 assert.equal(tasks.length,2);
});
test('disclosures have independent identities for different task cards',()=>{
 const item=id=>({dataset:{},closest:()=>({dataset:{taskCard:id}}),querySelector:()=>({textContent:'Материалы и обсуждение'})});
 assert.notEqual(disclosureKey(item('a')),disclosureKey(item('b')));
});
test('restoring a refresh keeps reading position and opened details',()=>{
 const oldDetails={dataset:{uiKey:'later'},open:true},newDetails={dataset:{uiKey:'later'},open:false};
 const oldArea={scrollTop:570},newArea={scrollTop:0};
 const snapshot=captureSurface({querySelector:()=>oldArea,querySelectorAll:()=>[oldDetails]});
 restoreSurface({querySelector:()=>newArea,querySelectorAll:()=>[newDetails]},snapshot);
 assert.equal(newArea.scrollTop,570);assert.equal(newDetails.open,true);
});
