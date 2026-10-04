import test from 'node:test';import assert from 'node:assert/strict';
import {draftKey,saveDraft,loadDraft,clearDraft} from '../docs/drafts.js';
const memory=()=>{const m=new Map;return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('draft survives a new read and is isolated by user and task',()=>{const s=memory(),k=draftKey('anna@test','result:1');assert(saveDraft(k,{text:'Half written'},s));assert.deepEqual(loadDraft(k,s),{text:'Half written'});assert.equal(loadDraft(draftKey('boss@test','result:1'),s),null);assert.equal(loadDraft(draftKey('anna@test','result:2'),s),null);clearDraft(k,s);assert.equal(loadDraft(k,s),null)});
test('unavailable or corrupt storage is handled without crashing the form',()=>{const broken={setItem(){throw Error('quota')},getItem(){return '{'},removeItem(){}};assert.equal(saveDraft('x',{},broken),false);assert.equal(loadDraft('x',broken),null)});
test('expired drafts are removed instead of restoring obsolete work',()=>{const s=memory();s.setItem('x',JSON.stringify({at:Date.now()-31*864e5,value:{text:'old'}}));assert.equal(loadDraft('x',s),null);assert.equal(s.getItem('x'),null)});
