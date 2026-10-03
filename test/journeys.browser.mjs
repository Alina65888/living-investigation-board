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
  const calls=[],errors=[],threads={},files={},problems=[{id:'help',task_id:'review',title:'Нужны реквизиты',detail:'Пришлите реквизиты исполнителя',author:team[1].email,status:'open',created_at:new Date().toISOString()}];
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
      if(b.action==='assign')for(const id of b.ids){const task=data.tasks.find(t=>t.id===id);Object.assign(task,b.patch);if(b.patch.lead)task.assignee=b.patch.lead;}
      revision++;out={ok:true,revision};
    }else if(path==='/api/task-thread'){
      if(b){(threads[b.id]??=[]).push({body:b.text,author:me.email,created_at:new Date().toISOString()});out={ok:true};}else out=threads[u.searchParams.get('id')]||[];
    }else if(path==='/api/task-files'){out=files[u.searchParams.get('taskId')]||[];}
    else if(path==='/api/problems'){if(b){Object.assign(problems.find(p=>p.id===b.id),b);out={ok:true};}else out=problems;}
    else if(path==='/api/notifications')out=[];
    else throw Error('Unexpected API path '+path);
    await route.fulfill({json:out});
  });
  await page.goto(base);await page.locator('#newTask').waitFor();
  return {page,context,calls,errors,data:()=>data,docs:()=>docs};
}
async function waitForSaved(page){await page.waitForFunction(()=>!document.querySelector('#saveState')?.textContent.includes('Сохраняю'));}
try{
  const a=await setup(),p=a.page;
  assert.equal(await p.locator('.view-tabs .tab').count(),4);
  await p.getByRole('heading',{name:'Что требует решения',exact:true}).waitFor();
  await p.locator('[data-accept-task="approval"]').click();
  await p.waitForFunction(()=>!document.querySelector('[data-accept-task="approval"]'));
  assert.equal(a.data().tasks.find(t=>t.id==='approval').status,'done');
  assert.equal(await p.locator('.modal-backdrop').count(),0,'accept must not require a second dialog');
  await p.locator('[data-answer="help"]').click();
  await p.locator('textarea[name=response]').fill('Реквизиты приложены');
  await p.locator('select[name=status]').selectOption('resolved');
  await p.locator('.modal [type=submit]').click();
  await p.locator('#newTask').click();
  assert.equal(await p.locator('#mProject').inputValue(),'','no arbitrary first project');
  assert.equal(await p.locator('#mAssignee').evaluate(e=>e.tagName),'SELECT');
  await p.locator('#mTitle').fill('Новая задача с проверкой');
  await p.locator('#mAssignee').selectOption(team[1].name);
  await p.locator('.task-options summary').click();
  await p.locator('#mResult').fill('Подписанный документ');await p.locator('#mReview').check();
  await p.locator('#mChecklist').fill('Проверить реквизиты\nСогласовать');
  await p.locator('.modal [type=submit]').click();await waitForSaved(p);
  const created=a.data().tasks.find(t=>t.title==='Новая задача с проверкой');
  assert.ok(created);assert.equal(created.projectId,'');assert.equal(created.requiresReview,true);assert.equal(created.checklist.length,2);assert.equal(created.expectedResult,'Подписанный документ');
  await p.locator('#inspector [data-close]').click();
  await p.locator('[data-project="p1"]').click();await p.locator('#newTask').click();assert.equal(await p.locator('#mProject').inputValue(),'p1');await p.locator('.modal [data-close]').click();
  await p.locator('[data-scope]').selectOption('today');
  await p.locator('tr[data-task="review"]').click();await p.goBack();
  assert.equal(await p.locator('[data-scope]').inputValue(),'today');
  assert.equal(await p.locator('[data-project-select]').inputValue(),'p1','project context survives back');
  await p.locator('tr[data-task="review"]').click();
  await p.locator('[data-create-doc]').click();
  await p.locator('[data-k="name"]').waitFor();await p.locator('[data-k="name"]').fill('Тестовая организация');
  await p.locator('[data-back]').click();
  await p.locator('[data-f="projectId"]').waitFor();assert.equal(await p.locator('[data-f="projectId"]').inputValue(),'p1');assert.equal(await p.locator('[data-f="taskId"]').inputValue(),'review');
  await p.locator('[data-next-step]').click();await p.locator('[data-f="subject"]').fill('Аренда оборудования');await p.locator('[data-f="number"]').fill('123');await p.locator('[data-f="deadline"]').fill('2026-12-01');
  await p.locator('[data-next-step]').click();assert.equal(await p.locator('[data-f="subject"]').isVisible(),false);
  await p.goBack();await p.locator('[data-f="subject"]').waitFor();assert.equal(await p.locator('[data-f="subject"]').inputValue(),'Аренда оборудования');
  await p.locator('[data-copy]').click();assert.equal(await p.locator('[data-f="number"]').inputValue(),'');assert.equal(await p.locator('[data-f="deadline"]').inputValue(),'');assert.equal(await p.locator('[data-f="subject"]').inputValue(),'Аренда оборудования');
  await p.locator('[data-back]').click();await p.locator('[data-view="home"]').click();await p.getByRole('heading',{name:'Что требует решения',exact:true}).waitFor();
  assert.equal(a.docs().deals.length,2);assert.equal(a.docs().deals.filter(d=>d.taskId==='review').length,1);
  if(shotDir)await p.screenshot({path:resolve(shotDir,'manager-desktop.png')});
  assert.deepEqual(a.errors,[]);console.log('PASS manager: decision queue, creation, history, linked documents and repeat deal');await a.context.close();

  const m=await setup('member'),q=m.page;
  assert.equal(await q.locator('.view-tabs .tab').count(),3);
  assert.equal(await q.locator('details.my-group').getAttribute('open'),null);
  await q.locator('[data-done="review"]').click();
  await q.locator('.modal textarea[name=text]').waitFor();assert.equal(m.data().tasks.find(t=>t.id==='review').status,'doing');
  await q.locator('.modal [data-close]').click();
  await q.locator('[data-attach="simple"]').click();await q.locator('.modal [name=url]').fill('https://example.test/material');await q.locator('.modal [type=submit]').click();
  await q.locator('.modal').waitFor({state:'detached'});assert.equal(m.data().tasks.find(t=>t.id==='simple').status,'doing');assert.ok(m.calls.some(c=>c.path==='/api/task-thread'&&c.body.text.includes('https://example.test/material')));
  await q.locator('#inspector [data-close]').click();
  await q.locator('[data-done="simple"]').click();await waitForSaved(q);assert.equal(m.data().tasks.find(t=>t.id==='simple').status,'done');
  await q.locator('.toast button').click();await waitForSaved(q);assert.equal(m.data().tasks.find(t=>t.id==='simple').status,'doing');assert.equal(m.data().tasks.find(t=>t.id==='simple').progress,30);
  await q.locator('[data-done="review"]').click();await q.locator('.modal textarea[name=text]').fill('Готовый договор');await q.locator('.modal [type=submit]').click();await q.locator('.modal').waitFor({state:'detached'});assert.equal(m.data().tasks.find(t=>t.id==='review').status,'approval');
  if(shotDir)await q.screenshot({path:resolve(shotDir,'member-desktop.png')});
  assert.deepEqual(m.errors,[]);console.log('PASS member: review gate, attach without completion, complete, undo, submit');await m.context.close();

  const mobile=await setup('admin',390),r=mobile.page;
  await r.getByRole('heading',{name:'Что требует решения',exact:true}).waitFor();
  assert.ok(await r.locator('#mobileMenu').isVisible());assert.ok(await r.locator('#newTask').isVisible());
  const overflows=await r.evaluate(()=>[...document.querySelectorAll('.topbar,.view-tabs,.main')].map(e=>({name:e.className,width:e.getBoundingClientRect().width,scroll:e.scrollWidth})).filter(e=>e.scroll>e.width+3));
  assert.deepEqual(overflows,[],'mobile navigation must fit the viewport');
  if(shotDir)await r.screenshot({path:resolve(shotDir,'manager-mobile.png')});
  await r.locator('[data-place=work]').click();await r.locator('[data-project-select]').selectOption('p1');assert.equal(await r.locator('#inspector').evaluate(e=>e.classList.contains('empty')),true,'choosing a project shows tasks without an inspector overlay');
  await r.locator('[data-view="docs"]').click();await r.locator('[data-new-deal]').click();await r.locator('[data-k="name"]').fill('Организация');await r.locator('[data-back]').click();await r.locator('[data-next-step]').click();
  assert.equal(await r.locator('[data-f="subject"]').isVisible(),true);
  if(shotDir)await r.screenshot({path:resolve(shotDir,'documents-mobile.png')});
  await r.locator('[data-step="1"]').click();await r.locator('[data-new-exec]').click();await r.locator('[data-k="name"]').fill('Исполнитель Тест');await r.locator('[data-back]').click();await r.locator('[data-step="2"]').click();await r.locator('[data-f="number"]').fill('ТЕСТ-1');await r.locator('[data-f="deadline"]').fill('2026-12-01');await r.locator('[data-f="subject"]').fill('Аренда оборудования');await r.locator('[data-it="name"]').fill('Оборудование');await r.locator('[data-it="price"]').fill('1000');await r.locator('[data-step="3"]').click();
  const downloadPromise=r.waitForEvent('download');await r.locator('[data-make="contract"]').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/ТЕСТ-1.*\.docx$/);assert.equal(await download.failure(),null);
  assert.deepEqual(mobile.errors,[]);console.log('PASS mobile: navigation and document steps');await mobile.context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
