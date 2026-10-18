// UI regression tests with synthetic team API responses. No production data or accounts.
// npm install --no-save playwright && npx playwright install chromium
// node test/journeys.browser.mjs
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {zip,unzipStored} from '../docs/docgen.js';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
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
async function setup(role='admin',width=1440){
  const context=await browser.newContext({viewport:{width,height:960},timezoneId:'Europe/Moscow'}),page=await context.newPage();
  let data=fixture(),revision=1,docs={parties:[{id:'own',own:true,kind:'org',name:'Тестовая организация',signer:'Тестов Иван Иванович',signerPosition:'Председатель'},{id:'exec',kind:'npd',fio:'Иванова Анна Ивановна'}],deals:[],version:1},docRevision=0;
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

// Exercise standard compressed DOCX as produced by Word, including central-directory sizes.
async function compressedDocx(files){
 const stored=new Uint8Array(await zip(files).arrayBuffer()),view=new DataView(stored.buffer),locals=[],centrals=[];let pos=0,offset=0;
 while(view.getUint32(pos,true)===0x04034b50){
  const size=view.getUint32(pos+18,true),nl=view.getUint16(pos+26,true),header=stored.slice(pos,pos+30+nl),data=deflateRawSync(stored.slice(pos+30+nl,pos+30+nl+size)),v=new DataView(header.buffer);
  v.setUint16(8,8,true);v.setUint32(18,data.length,true);locals.push(header,data);
  const central=new Uint8Array(46+nl),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);central.set(header.slice(4,26),6);c.setUint16(28,nl,true);c.setUint32(42,offset,true);central.set(header.slice(30),46);centrals.push(central);offset+=header.length+data.length;pos+=30+nl+size;
 }
 const end=stored.slice(-22),ev=new DataView(end.buffer);ev.setUint32(12,centrals.reduce((n,c)=>n+c.length,0),true);ev.setUint32(16,offset,true);
 return Buffer.concat([...locals,...centrals,end]);
}
try{
 const mobile=await setup('admin',390),p=mobile.page;
 await p.locator('[data-view="docs"]').click();await p.locator('[data-folder="mant-mt"]').click();await p.locator('[data-new-estimate]').click();
 const item={id:'source',section:0,name:'Руководитель <проекта>',description:'Координация команды & подрядчиков',unit:'месяц',qty:2,price:10000};
 const bytes=await p.evaluate(async item=>{const {estimateDocx}=await import('./project-docx.js');return [...new Uint8Array(await (await estimateDocx({year:2026,format:'competition',heading:'Смета',items:[item]},{})).arrayBuffer())];},item);
 const word=await compressedDocx(unzipStored(new Uint8Array(bytes).buffer));
 await p.locator('[data-budget-file]').setInputFiles({name:'Смета.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:word});
 await p.locator('[data-import-apply]').waitFor();assert.equal(await p.locator('[data-budget-item]').count(),0);assert.equal(await p.locator('[data-import-section]').count(),1);assert.equal(await p.locator('[data-import-section]').inputValue(),'0');
 await p.locator('[data-import-cancel]').click();assert.equal(await p.locator('[data-budget-item]').count(),0);
 await p.locator('[data-budget-file]').setInputFiles({name:'Смета.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:word});await p.locator('[data-import-apply]').click();
 assert.equal(await p.locator('table [data-budget-item]').count(),1);assert.equal(await p.locator('[data-budget-it=name]').inputValue(),item.name);assert.equal(await p.locator('[data-budget-it=description]').inputValue(),item.description);assert.equal(await p.locator('[data-budget-it=qty]').inputValue(),'2');assert.equal(await p.locator('[data-budget-it=price]').inputValue(),'10000');
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page fits phone');assert.ok(await p.locator('.budget-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth),'table scrolls sideways');
 await p.locator('[data-budget-it=qty]').fill('3');assert.match(await p.locator('[data-budget-grand-total]').textContent(),/30\s000/);
 const dl=p.waitForEvent('download');await p.locator('[data-budget-download]').click();const downloaded=await dl;assert.equal(await downloaded.failure(),null);
 if(shotDir){await p.locator('.budget-table-scroll').evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});await p.locator('.budget-table-scroll').scrollIntoViewIfNeeded();await p.screenshot({path:resolve(shotDir,'budget-table-mobile.png')});await p.setViewportSize({width:1440,height:1000});await p.locator('.budget-table-panel').scrollIntoViewIfNeeded();await p.screenshot({path:resolve(shotDir,'budget-table-desktop.png')});}
 await p.locator('[data-budget-select]').check();await p.locator('[data-budget-create]').click();await p.locator('[data-source-estimate]').click();
 await p.locator('[data-budget-file]').setInputFiles({name:'Еще смета.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:word});await p.locator('[data-import-apply]').click();
 assert.equal(await p.locator('[data-budget-item]').count(),2);assert.equal(await p.locator('[data-budget-select]:disabled').count(),1);await p.waitForFunction(()=>document.querySelector('[data-doc-save]')?.textContent==='Сохранено');
 await p.locator('[data-budget-view=register]').click();await p.locator('[data-budget-view=estimate]').click();await p.reload();await p.locator('[data-budget-item]').first().waitFor();assert.equal(await p.locator('[data-budget-item]').count(),2);assert.equal(mobile.docs().deals[0].items[0].qty,3);assert.deepEqual(mobile.errors,[]);
 // Reject wrong file types without losing current rows.
 await p.locator('[data-budget-file]').setInputFiles({name:'old.doc',mimeType:'application/msword',buffer:Buffer.from('old Word')});await p.getByText('Выберите файл .docx. Старый .doc сначала сохраните в Word как DOCX.',{exact:true}).waitFor();assert.equal(await p.locator('[data-budget-item]').count(),2);
 console.log('PASS Word import: compressed DOCX, preview/cancel, values, mobile table, export, append, existing contract and reload');await mobile.context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
