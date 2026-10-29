import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as P from '../docs/payment-orders.js';
import {paymentWorkbook,compoundWorkbook} from '../docs/payment-xls.js';
import {documentFilename} from '../docs/document-library.js';
import {customer,npd,company,deal,project} from './payment-fixtures.mjs';
const template=variant=>JSON.parse(readFileSync(new URL('../docs/templates/payment-'+variant+'.json',import.meta.url)));
function records(b){const v=new DataView(b.buffer,b.byteOffset,b.byteLength),out=[];for(let i=0;i<b.length;){const t=v.getUint16(i,true),n=v.getUint16(i+2,true);out.push([t,b.slice(i+4,i+4+n),i]);i+=4+n;}return out;}
test('payment variants, exact amount in words, date and correct payee identity',()=>{
 assert.equal(P.paymentVariant(npd),'npd');assert.equal(P.paymentVariant(company),'business');assert.equal(P.paymentVariant({...npd,kind:'person'}),null);
 assert.equal(P.paymentWords(14533.12),'Четырнадцать тысяч пятьсот тридцать три рубля 12 копеек');assert.equal(P.paymentWords(234000),'Двести тридцать четыре тысячи рублей 00 копеек');assert.equal(P.paymentWords(1.01),'Один рубль 01 копейка');assert.equal(P.paymentMoney(14533.12),'14533-12');
 assert.deepEqual(P.paymentIssues(deal,customer,npd,project),[]);
 const values=P.paymentValues(deal,customer,npd,project);assert.equal(values.F20,'КПП 0');assert.equal(values.A22,npd.fio);assert.equal(values.I4,'29.10.2026');assert.match(values.A29,/договору № 1\/К от 10.09.2026/);assert.match(values.A29,/Без налога \(НДС\)/);assert.doesNotMatch(values.A29,/НПД|6%/);
});
test('company and IP, invoice or act, partial payment and explicit VAT',()=>{
 const x={...deal,paymentAmount:'6100'};const v=P.paymentValues(x,customer,company,project);assert.equal(v.F20,'КПП 165301001');assert.match(v.A29,/сч. 09-26\/К1/);assert.match(v.A29,/НДС 22% — 1100-00/);assert.equal(v.M7,'6100-00');
 assert.equal(P.paymentValues(x,customer,{...npd,kind:'ip'},project).F20,'КПП ');assert.match(P.paymentValues({...deal,paymentBasis:'act'},customer,npd,project).A29,/и акту от 19.10.2026/);
 assert.equal(P.paymentValues({...deal,paymentIncomeCode:'1',paymentUin:'0'},customer,npd,project).M24,'1');
});
test('missing, zero, negative, invalid date, malformed bank fields and duplicate numbers block export',()=>{
 for(const patch of [{paymentNumber:''},{paymentNumber:'0'},{paymentNumber:'1234567'},{paymentDate:'2026-02-30'},{paymentAmount:'0'},{paymentAmount:'-1'},{paymentAmount:'1.001'},{paymentAmount:'x'},{paymentPurpose:'А'.repeat(211)},{paymentBasis:'invoice'}])assert.throws(()=>P.paymentValues({...deal,...patch},customer,npd,project));
 for(const patch of [{account:''},{corr:''},{bik:'000'},{inn:'52546386689x'},{bank:''}])assert.throws(()=>P.paymentValues(deal,customer,{...npd,...patch},project));
 assert.ok(P.paymentIssues(deal,customer,npd,project,[{...deal,id:'other'}]).some(s=>s.includes('уже указан')));
 assert.equal(P.paymentIssues(deal,customer,npd,project,[deal]).length,0);
 assert.throws(()=>P.paymentValues(deal,customer,{...company,vatRate:undefined},project));
});
test('filenames use payment date and number, counterparty and short project code',()=>{
 assert.equal(documentFilename('payment',deal,npd,project),'2026.10.29 Платежное поручение № 28 Иванова А. П. (КНТ).xls');
});
test('BIFF formatting and print records are byte-preserved; SST has no hidden template/example data',async()=>{
 for(const e of [npd,company,{...npd,kind:'ip'}]){
  const t=template(P.paymentVariant(e)),w=paymentWorkbook(t,P.paymentValues(deal,customer,e,project)),rs=records(w);
  for(const tag of [0x31,0xe0,0x7d,0x208,0xe5,0x26,0x27,0x28,0x29,0xa1])assert.deepEqual(rs.filter(r=>r[0]===tag).map(r=>Buffer.from(r[1]).toString('base64')),t.records.filter(r=>r[0]===tag).map(r=>r[1]),'preserve '+tag.toString(16));
  const bounds=rs.find(r=>r[0]===0x85);assert.equal(new DataView(bounds[1].buffer).getUint32(0,true),rs.find(r=>r[0]===0x809&&new DataView(r[1].buffer).getUint16(2,true)===0x10)[2]);
  assert.ok(!Buffer.from(w).toString('utf16le').includes('{{'));const file=compoundWorkbook(w);assert.equal(Buffer.from(file.slice(0,8)).toString('hex'),'d0cf11e0a1b11ae1');
  if(process.env.PP_OUTPUT){mkdirSync(process.env.PP_OUTPUT,{recursive:true});writeFileSync(process.env.PP_OUTPUT+'/'+e.kind+'.xls',file);}
 }
});
