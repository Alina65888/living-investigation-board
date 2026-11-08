import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../docs/google-drive.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'const apiUrl=x=>x; const hosted=true;\n');
const {saveToDrive}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
globalThis.FileReader=class {readAsDataURL(){this.result='data:application/octet-stream;base64,UEs=';this.onload();}};
const reply=x=>({ok:true,json:async()=>x});
test('Unbound project never sends document bytes',async()=>{
 const calls=[];globalThis.fetch=async(path,opts)=>{calls.push([path,opts]);return reply({bindings:[],connected:true});};
 assert.deepEqual(await saveToDrive(new Blob(['x']),'test.docx','mant-pearl',2026),{skipped:true});assert.equal(calls.length,1);
});
test('A different year is not implicitly linked',async()=>{
 globalThis.fetch=async()=>reply({bindings:[{project:'mant-pearl',year:'2025'}],connected:true});
 assert.deepEqual(await saveToDrive(new Blob(['x']),'test.docx','mant-pearl',2026),{skipped:true});
});
test('Bound document uploads with project/year and CSRF header',async()=>{
 const calls=[];globalThis.fetch=async(path,opts)=>{calls.push([path,opts]);return reply(path.endsWith('status')?{bindings:[{project:'mant-pearl',year:'2026'}],connected:true}:{id:'synthetic-file'});};
 const result=await saveToDrive(new Blob(['x']),'test.docx','mant-pearl',2026);
 assert.equal(result.id,'synthetic-file');assert.equal(calls.length,2);
 assert.equal(calls[1][1].headers['X-HQ-Drive'],'1');assert.equal(calls[1][1].credentials,'same-origin');
 assert.deepEqual(JSON.parse(calls[1][1].body),{project:'mant-pearl',year:'2026',name:'test.docx',content:'UEs='});
});
test('Disconnected and failed uploads do not report success',async()=>{
 globalThis.fetch=async()=>reply({bindings:[{project:'mant-pearl',year:'2026'}],connected:false});
 await assert.rejects(()=>saveToDrive(new Blob(['x']),'test.docx','mant-pearl',2026),/отключён/);
 globalThis.fetch=async path=>path.endsWith('status')?reply({bindings:[{project:'mant-pearl',year:'2026'}],connected:true}):{ok:false,json:async()=>({error:'Google unavailable'})};
 await assert.rejects(()=>saveToDrive(new Blob(['x']),'test.docx','mant-pearl',2026),/Google unavailable/);
});
