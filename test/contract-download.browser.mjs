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


try{
 for(const kind of ['ip','org']){
  const a=await setup('admin',390,kind),p=a.page;
  assert.deepEqual(G.checkDeal(a.docs().deals[0],a.docs().parties[0],a.docs().parties[1]),[]);
  await p.locator('[data-view="docs"]').click();
  await p.locator('[data-deal="contract-test"]').click();
  await p.locator('[data-step="2"]').click();
  assert.match(await p.locator('[data-template-terms]').textContent(),/15 рабочих дней/);
  await p.locator('[data-step="3"]').click();
  assert.equal(await p.locator('[data-step-hint]').textContent(),'Можно скачивать');
  assert.equal(await p.locator('[data-make="contract"]').isEnabled(),true);
  assert.equal(await p.locator('[data-make="invoice"]').isEnabled(),true);
  assert.equal(await p.locator('[data-make="upd"]').isEnabled(),true);
  assert.match(await p.locator('[data-download-template]').textContent(),kind==='ip'?/Поставка — ИП/:/Поставка — организация/);
  await p.locator('[data-make="contract"]').evaluate(e=>e.scrollIntoView({block:'center'}));
  assert.equal(await p.locator('[data-make="contract"]').evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'download button must not be covered by the footer');
  if(shotDir){await p.screenshot({path:resolve(shotDir,'contract-'+kind+'-mobile.png')});}
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const pending=p.waitForEvent('download');await p.locator('[data-make="contract"]').click();
  const download=await pending;assert.equal(await download.failure(),null);
  assert.match(download.suggestedFilename(),/Договор.*\.docx$/);
  const files=G.unzipStored(Uint8Array.from(await readFile(await download.path())).buffer);
  const xml=new TextDecoder().decode(files['word/document.xml']);
  assert.match(xml,/поставки № 7/);assert.doesNotMatch(xml,/Налог на профессиональный доход/);
  // An existing service deal is never silently relabelled as supply.
  await p.locator('[data-step="2"]').click();await p.locator('[data-type="services"]').click();
  await p.locator('[data-step="3"]').click();
  assert.equal(await p.locator('[data-fix-contract]').textContent(),'Проверить тип сделки');
  await p.locator('[data-fix-contract]').click();
  assert.equal(await p.locator('[data-type="services"].active').isVisible(),true);
  assert.equal(a.docs().parties[1].kind,kind);
  assert.deepEqual(a.errors,[]);await a.context.close();
 }
 const a=await setup('admin',390,'npd','services'),p=a.page;
 await p.locator('[data-view="docs"]').click();await p.locator('[data-deal="contract-test"]').click();
 await p.locator('[data-step="2"]').click();
 assert.match(await p.locator('[data-template-terms]').textContent(),/15 календарных дней/);
 await p.locator('[data-f="period"]').fill('');await p.locator('[data-step="3"]').click();
 assert.equal(await p.locator('[data-fix-contract]').textContent(),'Указать период услуг');
 await p.locator('[data-fix-contract]').click();
 assert.equal(await p.locator('[data-f="period"]').evaluate(e=>e===document.activeElement),true);
 await p.locator('[data-f="period"]').fill('с 1 по 31 октября 2026 г.');
 await p.locator('[data-step="3"]').click();
 assert.equal(await p.locator('[data-make="invoice"]').count(),0);
 const pending=p.waitForEvent('download');await p.locator('[data-make="contract"]').click();
 const download=await pending;assert.equal(await download.failure(),null);
 const files=G.unzipStored(Uint8Array.from(await readFile(await download.path())).buffer);
 const xml=new TextDecoder().decode(files['word/document.xml']);
 assert.match(xml,/Самозанятый/);assert.doesNotMatch(xml,/Гражданка/);
 assert.deepEqual(a.errors,[]);await a.context.close();
 console.log('PASS mobile downloads: IP supply, organisation supply, NPD services; explicit type and period recovery');
}finally{await browser.close();await new Promise(r=>server.close(r));}
