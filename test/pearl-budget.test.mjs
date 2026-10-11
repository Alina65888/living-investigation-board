import test from 'node:test';
import assert from 'node:assert/strict';
import {seedPearlBudget,resolveSourcePrice,PEARL_SEED} from '../docs/pearl-budget.js';
import {budgetGroups,budgetIssues,itemsForDeal} from '../docs/project-budget.js';
const data=()=>({folders:[{id:'mant-pearl'}],parties:[{id:'mant',own:true,kind:'org',shortName:'МАНТ'},{id:'ckd',own:true,kind:'org',shortName:'ЦКД'}],estimates:[]});
test('Pearl import contains all 14 source lines and exact section amounts, preserving unresolved discrepancy',()=>{
 const d=data();assert.equal(seedPearlBudget(d),true);const e=d.estimates[0];assert.equal(e.items.length,14);assert.equal(e.customerId,'mant');assert.equal(e.sourceTotal,300000);
 assert.deepEqual(budgetGroups(e).map(g=>g.total),[124920,56800,65820,53000]);assert.equal(budgetIssues(e).length,1);
 assert.throws(()=>itemsForDeal(e,[e.items[8].id]),/расхождение/);assert.equal(itemsForDeal(e,[e.items[0].id]).length,1);
 resolveSourcePrice(e.items[8],15280);assert.deepEqual(budgetIssues(e),[]);assert.deepEqual(budgetGroups(e).map(g=>g.total),[124920,56800,65280,53000]);
 assert.equal(e.items[6].qty,15);assert.equal(e.items[12].qty,10);assert.match(e.items[13].description,/последующего информационного освещения/);
});
test('import is one-time and preserves user edits, existing estimates and explicit deletion',()=>{
 const d=data();const existing={id:'custom',folderId:'mant-pearl',year:'2026',items:[{name:'Моя позиция'}]};d.estimates.push(existing);
 seedPearlBudget(d);assert.equal(d.estimates[0],existing);d.estimates[1].items[0].price=123;
 assert.equal(seedPearlBudget(d),false);assert.equal(d.estimates[1].items[0].price,123);
 d.estimates=d.estimates.filter(e=>e.id!==PEARL_SEED);assert.equal(seedPearlBudget(d),false);assert.equal(d.estimates.length,1);
});
test('never guesses a customer from a different organization or duplicates an existing imported budget',()=>{
 const d=data();d.parties=d.parties.filter(p=>p.id==='ckd');seedPearlBudget(d);assert.equal(d.estimates[0].customerId,'');
 delete d.appliedEstimateSeeds;seedPearlBudget(d);assert.equal(d.estimates.length,1);
 const e=d.estimates[0];resolveSourcePrice(e.items[8],15820);assert.deepEqual(budgetIssues(e),[]);assert.equal(budgetGroups(e).reduce((s,g)=>s+g.total,0),300540);
});
