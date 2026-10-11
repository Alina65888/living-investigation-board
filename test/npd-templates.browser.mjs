// UI regression tests with synthetic team API responses. No production data or accounts.
// npm install --no-save playwright && npx playwright install chromium
// node test/contract-download.browser.mjs
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
import * as G from '../docs/docgen.js';
function personInn(base = '7707083') {
  const d = (base + '000').slice(0, 10).split('').map(Number), k = w => w.reduce((s, x, i) => s + x * d[i], 0) % 11 % 10;
  d[10] = k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]); d[11] = k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  return d.join('');
}
const bank = { bank: 'ПАО Сбербанк', bik: '044525225', corr: '30101810400000000225' };
// Public requisites of a large bank, used as a well-known valid organisation.
const org = { kind: 'org', name: 'Общество с ограниченной ответственностью «Пример»', inn: '7707083893', kpp: '773601001', ogrn: '1027700132195', address: 'г. Москва', account: '40702810938000000001', ...bank, signer: 'Иванов Пётр Сергеевич', signerPosition: 'генеральный директор' };
const ngo = { ...org, name: 'Региональная общественная организация «Пример»', signer: 'Петрова Анна Ильинична', signerPosition: 'председатель' };
const npd = { kind: 'npd', fio: 'Смирнова Елена Олеговна', inn: personInn(), npdDate: '2022-01-10', npdNumber: '123456', passport: '0000 000000, выдан 01.01.2020', address: 'г. Казань', account: '40817810738000000002', ...bank };

const root=resolve(import.meta.dirname,'../docs');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const shotDir=process.env.JOURNEY_SCREENSHOTS;
if(shotDir)await mkdir(shotDir,{recursive:true});
const team=[{name:'Руководитель Тест',email:'boss@example.test',role:'admin',active:true},{name:'Анна Тест',email:'anna@example.test',role:'member',active:true}];
const date=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Moscow'});
function fixture(){const task=(id,title,extra={})=>({id,title,projectId:'p1',stageId:'s1',status:'doing',dueDate:date,assignee:team[1].name,lead:team[1].name,assigneeEmail:team[1].email,assigneeEmails:[team[1].email],checklist:[],progress:30,priority:'medium',...extra});return {organizations:[{id:'o1',name:'Тестовое пространство'}],projects:[{id:'p1',orgId:'o1',name:'Форум',owner:team[0].name},{id:'p2',orgId:'o1',name:'Выставка'}],stages:[{id:'s1',projectId:'p1',name:'Подготовка',order:1}],tasks:[task('simple','Позвонить на площадку'),task('review','Подготовить договор',{requiresReview:true}),task('approval','Проверить программу',{status:'approval',requiresReview:true,result:{text:'Программа подготовлена',url:'https://example.test/result',fileIds:[]}}),task('inbox','Распределить поручение',{projectId:'',assignee:'',assigneeEmail:'',assigneeEmails:[]}),task('later','Дальняя задача',{dueDate:'2099-01-01'})],relations:[],events:[],milestones:[],meta:{demo:false}};}
async function setup(role='admin',width=1440,kind='ip',type='supply'){
  const context=await browser.newContext({viewport:{width,height:960},timezoneId:'Europe/Moscow'}),page=await context.newPage();
  let data=fixture(),revision=1,docs={parties:[{...org,id:'customer',own:true},{...(kind==='org'?org:npd),id:'executor',kind,inn:kind==='org'?'1653001805':npd.inn,ogrn:kind==='org'?org.ogrn:'12345678901234'+String(12345678901234n%13n%10n)}],deals:[{id:'contract-test',customerId:'customer',executorId:'executor',type,number:'7',date:'2026-10-01',deadline:'2026-10-31',subject:'Услуги',period:'с 1 по 31 октября 2026 г.',items:[{name:'Услуги',unit:'услуга',qty:1,price:1000}]}],version:1},docRevision=0;
  const calls=[],errors=[],threads={},files={},problems=[{id:'help',task_id:'review',title:'Нужны реквизиты',detail:'Пришлите реквизиты исполнителя',author:team[1].email,status:'open',response:'Реквизиты будут утром',created_at:new Date().toISOString()}];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  const me=team[role==='admin'?0:1];
  await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url()),path=u.pathname,body=req.postDataJSON?.bind(req);let out;
    let b=null;try{b=body();}catch{}
    if(req.method()==='POST')calls.push({path,body:b});
    if(path==='/api/me')out={team:true,me,setup:false};
    else if(path==='/api/workspace'){
      if(b){data=structuredClone(b.data);revision++;}
      out={data,revision,me,team};
    }else if(path==='/api/docs'){
      if(role!=='admin'){await route.fulfill({status:403,json:{error:'Нет доступа'}});return;}
      if(b){assert.equal(b.revision,docRevision,'document saves must serialize revisions');docs=structuredClone(b.data);docRevision++;out={revision:docRevision};}else out={data:docs,revision:docRevision};
    }else if(path==='/api/task-actions'){
      const t=data.tasks.find(t=>t.id===b.id);
      if(b.action==='submit'){t.result={text:b.text,url:b.url,fileIds:b.fileIds,review:null};t.status=t.requiresReview||b.review?'approval':'done';}
      if(b.action==='accept'){t.status='done';t.result={...t.result,review:{decision:'accept',note:b.note}};}
      if(b.action==='return'){t.status='doing';t.result={...t.result,review:{decision:'return',note:b.note}};}
      if(b.action==='assign')for(const id of b.ids){const task=data.tasks.find(t=>t.id===id);Object.assign(task,b.patch);if('lead' in b.patch){task.contributors=(b.patch.contributors??task.contributors??[]).filter(n=>n!==b.patch.lead);task.assignee=[b.patch.lead,...task.contributors].filter(Boolean).join(', ');}}
      revision++;out={ok:true,revision};
    }else if(path==='/api/task-thread'){
      if(b){(threads[b.id]??=[]).push({body:b.text,author:me.email,created_at:new Date().toISOString()});out={ok:true};}else out=threads[u.searchParams.get('id')]||[];
    }else if(path==='/api/task-files'){out=files[u.searchParams.get('taskId')]||[];}
    else if(path==='/api/problems'){if(b){b.id?Object.assign(problems.find(p=>p.id===b.id),b):problems.push({...b,id:'question-'+problems.length,task_id:b.taskId,author:me.email,status:'open',created_at:new Date().toISOString()});out={ok:true};}else out=problems;}
    else if(path==='/api/notifications')out=[];
    else throw Error('Unexpected API path '+path);
    await route.fulfill({json:out});
  });
  await page.goto(base);await page.locator('#newTask').waitFor();
  return {page,context,calls,errors,data:()=>data,docs:()=>docs};
}
async function waitForSaved(page){await page.waitForFunction(()=>!document.querySelector('#saveState')?.textContent.includes('Сохраняю'));}

// A Word-like save: tokens can span runs, and ZIP entries are compressed.
import {deflateRawSync} from 'node:zlib';
function compressedWord(files){
 const parts=[],central=[];let offset=0;
 const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
 for(const [name,data]of Object.entries(files)){
  const filename=Buffer.from(name),body=Buffer.from(data),packed=deflateRawSync(body),check=crc(body),h=Buffer.alloc(30),c=Buffer.alloc(46);
  h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(check,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(body.length,22);h.writeUInt16LE(filename.length,26);
  c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(check,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
  parts.push(h,filename,packed);central.push(c,filename);offset+=h.length+filename.length+packed.length;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(central.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,...central,end]);
}
const decode=b=>new TextDecoder().decode(b),encode=s=>new TextEncoder().encode(s);
const readDownload=async(page,action)=>{const next=page.waitForEvent('download');await action();const download=await next;assert.equal(await download.failure(),null);return Uint8Array.from(await readFile(await download.path())).buffer;};
try{
 const a=await setup('admin',390,'npd','services'),p=a.page;
 await p.locator('[data-view="docs"]').click();await p.locator('[data-deal="contract-test"]').click();await p.locator('[data-step="2"]').click();
 await p.locator('[data-it=name]').fill('Руководитель проекта');
 assert.equal(await p.locator('[data-it=contractName]').getAttribute('placeholder'),'руководителя проекта');
 await p.locator('[data-use-subject]').click();assert.equal(await p.locator('[data-f=subject]').inputValue(),'руководителя проекта');
 assert.equal(await p.locator('[data-it=name]').inputValue(),'Руководитель проекта');
 await p.locator('[data-it=contractName]').fill('координатора проекта');await p.locator('[data-use-subject]').click();
 assert.equal(await p.locator('[data-f=subject]').inputValue(),'координатора проекта');
 await p.locator('[data-f=date]').fill('2026-03-01');await p.locator('[data-f=period]').fill('с 1 по 9 марта 2026 г.');
 if(shotDir)await p.screenshot({path:resolve(shotDir,'wording-mobile.png')});
 await p.locator('[data-back]').click();await p.locator('[data-open-templates]').click();
 const blank=await readDownload(p,()=>p.locator('[data-template-download=services]').click());
 const files=G.unzipStored(blank),xml=decode(files['word/document.xml']);assert.match(xml,/\{\{#items\}\}/);assert.match(xml,/\{\{\/items\}\}/);
 files['word/document.xml']=encode(xml.replace('{{serviceSubject}}','{{service</w:t></w:r><w:r><w:t>Subject}}').replace('ДОГОВОР','ДОГОВОР ОБНОВЛЕН'));
 const payload=compressedWord(files);
 await p.locator('[data-template-upload=services]').setInputFiles({name:'Обновленный договор.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:payload});
 await p.locator('[data-template-review]:not([hidden])').waitFor();assert.equal(await p.locator('[data-template-apply]').isDisabled(),true);
 const preview=await readDownload(p,()=>p.locator('[data-template-preview]').click());
 const filled=decode(G.unzipStored(preview)['word/document.xml']);assert.match(filled,/ДОГОВОР ОБНОВЛЕН/);assert.doesNotMatch(filled,/\{\{|items:/);
 assert.match(filled,/руководителя проекта/);assert.match(filled,/Руководитель проекта/);assert.match(filled,/01 марта 2026/);
 await p.locator('[data-template-checked]').check();
 const rejectSave=async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,json:{error:'Проверка: сервер временно недоступен'}});else await route.fallback();};
 await p.route('**/api/docs',rejectSave);await p.locator('[data-template-apply]').click();
 await p.waitForFunction(()=>document.querySelector('[data-template-error]').textContent.includes('сервер временно недоступен'));
 assert.equal(a.docs().templates?.services,undefined,'failed activation must not replace the builtin');
 await p.unroute('**/api/docs',rejectSave);await p.locator('[data-template-apply]').click();
 await p.locator('[data-template-review][hidden]').waitFor({state:'attached'});assert.ok(a.docs().templates.services.data);
 await p.reload();await p.locator('[data-template-download=services]').waitFor();assert.match(await p.locator('[data-template-cards]').textContent(),/Обновленный договор.docx/);
 const restored=await readDownload(p,()=>p.locator('[data-template-download=services]').click());assert.match(decode(G.unzipStored(restored)['word/document.xml']),/ДОГОВОР ОБНОВЛЕН/);
 // Missing and unknown fields never replace the active version.
 files['word/document.xml']=encode(xml.replace('{{date}}','без даты'));
 await p.locator('[data-template-upload=services]').setInputFiles({name:'Плохой.docx',mimeType:'application/octet-stream',buffer:compressedWord(files)});
 await p.locator('[data-template-error]:not([hidden])').waitFor();assert.match(await p.locator('[data-template-error]').textContent(),/Не хватает полей/);assert.equal(a.docs().templates.services.name,'Обновленный договор.docx');
 files['word/document.xml']=encode(xml.replace('{{date}}','{{unknown}}'));
 await p.locator('[data-template-upload=services]').setInputFiles({name:'Плохой.docx',mimeType:'application/octet-stream',buffer:compressedWord(files)});
 await p.waitForFunction(()=>document.querySelector('[data-template-error]').textContent.includes('Неизвестное поле'));
 // Second valid revision and rollback to the first.
 files['word/document.xml']=encode(xml.replace('ДОГОВОР','ДОГОВОР ВТОРОЙ'));
 await p.locator('[data-template-upload=services]').setInputFiles({name:'Второй.docx',mimeType:'application/octet-stream',buffer:compressedWord(files)});
 await p.locator('[data-template-review]:not([hidden])').waitFor();await readDownload(p,()=>p.locator('[data-template-preview]').click());await p.locator('[data-template-checked]').check();await p.locator('[data-template-apply]').click();await p.locator('[data-template-review][hidden]').waitFor({state:'attached'});
 assert.equal(a.docs().templates.services.previous.name,'Обновленный договор.docx');
 await p.locator('[data-template-restore=services]').click();await p.waitForFunction(()=>document.querySelector('[data-template-cards]').textContent.includes('Обновленный договор.docx'));
 assert.equal(a.docs().templates.services.name,'Обновленный договор.docx');
 // Separate act update, with the real three-line heading retained.
 const actBlank=await readDownload(p,()=>p.locator('[data-template-download="act-npd"]').click());
 const actFiles=G.unzipStored(actBlank);actFiles['word/document.xml']=encode(decode(actFiles['word/document.xml']).replace('Акт подтверждает','Акт также подтверждает'));
 await p.locator('[data-template-upload="act-npd"]').setInputFiles({name:'Акт.docx',mimeType:'application/octet-stream',buffer:compressedWord(actFiles)});
 await p.locator('[data-template-review]:not([hidden])').waitFor();const actPreview=await readDownload(p,()=>p.locator('[data-template-preview]').click());
 const actText=decode(G.unzipStored(actPreview)['word/document.xml']);assert.match(actText,/Акт также подтверждает/);assert.match(actText,/об исполнении обязательств по <\/w:t><w:br[^>]*\/><w:t[^>]*>Договору оказания услуг/);
 await p.locator('[data-template-checked]').check();await p.locator('[data-template-apply]').click();await p.locator('[data-template-review][hidden]').waitFor({state:'attached'});
 if(shotDir)await p.screenshot({path:resolve(shotDir,'templates-mobile.png')});
 await p.locator('[data-back]').click();await p.locator('[data-deal=contract-test]').click();await p.locator('[data-step="3"]').click();
 const actual=await readDownload(p,()=>p.locator('[data-make=contract]').click()),actualText=decode(G.unzipStored(actual)['word/document.xml']);
 assert.match(actualText,/ДОГОВОР ОБНОВЛЕН/);assert.match(actualText,/координатора проекта/);assert.match(actualText,/Руководитель проекта/);assert.match(actualText,/с 01 по 09 марта/);
 const actualAct=await readDownload(p,()=>p.locator('[data-make=act]').click());assert.match(decode(G.unzipStored(actualAct)['word/document.xml']),/Акт также подтверждает/);
 assert.deepEqual(a.errors,[]);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile page must not overflow');
 await a.context.close();console.log('PASS NPD: editable forms, compressed/split Word fields, validation, preview, activation, reload, rollback, contract and act downloads');
}finally{await browser.close();await new Promise(r=>server.close(r));}
