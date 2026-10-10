// UI regression tests with synthetic team API responses. No production data or accounts.
// npm install --no-save playwright && npx playwright install chromium
// node test/journeys.browser.mjs
import assert from 'node:assert/strict';
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
  let data=fixture(),revision=1,docs={parties:[],deals:[],version:1},docRevision=0;
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
  const mobile=await setup('admin',390),r=mobile.page;
  await r.locator('[data-view="docs"]').click();
  await r.locator('[data-folder]').first().waitFor();
  assert.equal(await r.locator('[data-folder]').count(),20);
  if(shotDir)await r.screenshot({path:resolve(shotDir,'folders-mobile.png'),fullPage:true});
  await r.locator('[data-doc-org="МАНТ"]').click();
  assert.equal(await r.locator('[data-folder]').count(),11);
  await r.locator('[data-folder="mant-mt"]').click();
  await r.locator('[data-new-deal]').click();
  await r.locator('[data-k="name"]').fill('Организация');
  await r.locator('[data-back]').click();
  assert.equal(await r.locator('[data-f="folderId"]').inputValue(),'mant-mt');
  await r.locator('[data-new-exec]').click();
  await r.locator('[data-kind="npd"]').click();
  await r.locator('[data-k="fio"]').fill('Иванова Анна Ивановна');
  await r.locator('[data-back]').click();
  await r.locator('[data-step="2"]').click();
  await r.locator('[data-f="number"]').fill('1/МТ');
  await r.locator('[data-f="date"]').fill('2026-09-20');
  await r.locator('[data-f="deadline"]').fill('2026-10-31');
  await r.locator('[data-f="subject"]').fill('Проведение мастер-класса');
  await r.locator('[data-f="period"]').fill('с 20 сентября по 31 октября 2026 г.');
  await r.locator('[data-it="name"]').fill('Мастер-класс');
  await r.locator('[data-it="price"]').fill('1000');
  await r.locator('[data-step="3"]').click();
  const expected='2026.09.20 Договор № 1_МТ Иванова А. И. (МТ).docx';
  await r.getByText(expected,{exact:true}).waitFor();
  assert.ok(await r.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'filenames fit mobile');
  if(shotDir){await r.locator('.docs-filenames').scrollIntoViewIfNeeded();await r.screenshot({path:resolve(shotDir,'filenames-mobile.png'),fullPage:true});}
  const pending=r.waitForEvent('download');await r.locator('[data-make="contract"]').click();
  const download=await pending;assert.equal(download.suggestedFilename(),expected);assert.equal(await download.failure(),null);
  await r.locator('[data-back]').click();
  await r.locator('[data-year="2026"]').click();
  assert.equal(await r.locator('[data-deal]').count(),1);
  await r.reload();await r.locator('[data-deal]').waitFor();
  assert.equal(await r.locator('[data-deal]').count(),1,'folder/year context survives reload');
  await r.locator('[data-folder-edit]').click();
  await r.locator('[name="code"]').fill('МТ26');
  await r.locator('[data-folder-form] [type=submit]').click();
  await r.locator('[data-deal]').click();
  await r.locator('[data-step="3"]').click();
  await r.getByText(expected.replace('(МТ)','(МТ26)'),{exact:true}).waitFor();
  await r.locator('[data-step="1"]').click();
  await r.locator('[data-f="folderId"]').selectOption('ckd-dictation');
  await r.locator('[data-back]').click();
  assert.equal(await r.locator('[data-deal]').count(),0,'moved deal leaves former folder');
  await r.locator('[data-doc-org="ЦКД"]').click();
  await r.locator('[data-folder="ckd-dictation"]').click();
  assert.equal(await r.locator('[data-deal]').count(),1,'moved deal appears in destination');
  await r.locator('[data-folder=""]').click();
  await r.locator('[data-folder-new]').click();
  await r.locator('[name="name"]').fill('Новый проект');
  await r.locator('[name="code"]').fill('НП');
  await r.locator('[data-folder-form] [type=submit]').click();
  await r.waitForFunction(()=>document.querySelector('[data-folder-edit]'));
  await r.waitForTimeout(700);
  assert.ok(mobile.docs().folders.some(f=>f.name==='Новый проект'&&f.organization==='ЦКД'));
  assert.equal(mobile.docs().deals.length,1);
  assert.equal(mobile.docs().deals[0].folderId,'ckd-dictation');
  assert.ok(await r.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'folder view fits mobile');
  assert.deepEqual(mobile.errors,[]);
  console.log('PASS document folders: navigation, years, rename, move, persistence and exact download name');
  await mobile.context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
