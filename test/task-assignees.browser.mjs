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
function fixture(){const task=(id,title,extra={})=>({id,title,projectId:'p1',stageId:'s1',status:'doing',dueDate:date,assignee:team[1].name,lead:team[1].name,assigneeEmail:team[1].email,assigneeEmails:[team[1].email],checklist:[],progress:30,priority:'medium',...extra});return {organizations:[{id:'o1',name:'Тестовое пространство'}],projects:[{id:'p1',orgId:'o1',name:'Форум',owner:team[0].name},{id:'p2',orgId:'o1',name:'Выставка'}],stages:[{id:'s1',projectId:'p1',name:'Подготовка',order:1}],tasks:[task('simple','Позвонить на площадку'),task('review','Подготовить договор',{requiresReview:true}),task('approval','Проверить программу',{status:'approval',requiresReview:true,result:{text:'Программа подготовлена',url:'https://example.test/result',fileIds:[]}}),task('inbox','Распределить поручение',{projectId:'',assignee:'',lead:'',assigneeEmail:'',assigneeEmails:[]}),task('later','Дальняя задача',{dueDate:'2099-01-01'})],relations:[],events:[],milestones:[],meta:{demo:false}};}
async function setup(role='admin',width=1440){
  const context=await browser.newContext({viewport:{width,height:960},timezoneId:'Europe/Moscow'}),page=await context.newPage();
  let data=fixture(),revision=1,docs={parties:[],deals:[],version:1},docRevision=0;
  Object.assign(data.tasks.find(t=>t.id==='later'),{projectId:'p2',lead:team[0].name,assignee:team[0].name,assigneeEmail:team[0].email,assigneeEmails:[team[0].email]});
  Object.assign(data.tasks.find(t=>t.id==='review'),{contributors:[team[0].name],assignee:team.map(m=>m.name).join(', '),assigneeEmails:team.map(m=>m.email)});
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
 const a=await setup('admin',390),p=a.page;
 await p.locator('[data-place=work]').click();
 const ids=()=>p.locator('.task-table tbody [data-task]').evaluateAll(rows=>rows.map(r=>r.dataset.task).sort());
 assert.equal(await p.locator('[data-assignee-select]').inputValue(),'all');assert.equal((await ids()).length,5);
 await p.locator('[data-assignee-select]').selectOption('email:boss@example.test');assert.deepEqual(await ids(),['later','review']);
 await p.locator('[data-project-select]').selectOption('p1');assert.deepEqual(await ids(),['review']);assert.equal(await p.locator('[data-assignee-select]').inputValue(),'email:boss@example.test');
 await p.reload();await p.locator('[data-assignee-select]').waitFor();assert.deepEqual(await ids(),['review']);assert.equal(await p.locator('[data-project-select]').inputValue(),'p1');
 await p.locator('[data-assignee-select]').selectOption('email:anna@example.test');assert.deepEqual(await ids(),['approval','review','simple']);
 await p.goBack();await p.waitForFunction(()=>document.querySelector('[data-assignee-select]')?.value==='email:boss@example.test');assert.deepEqual(await ids(),['review']);
 await p.locator('[data-project-select]').selectOption('all');await p.locator('[data-scope]').selectOption('today');assert.deepEqual(await ids(),['review']);
 await p.locator('[data-scope]').selectOption('all');await p.setViewportSize({width:1440,height:960});await p.locator('#search').fill('Дальняя');assert.deepEqual(await ids(),['later']);
 await p.locator('[data-reset-context]').click();assert.equal((await ids()).length,5);assert.equal(await p.locator('[data-assignee-select]').inputValue(),'all');
 await p.setViewportSize({width:390,height:960});await p.locator('[data-assignee-select]').selectOption('unassigned');assert.deepEqual(await ids(),['inbox']);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone page fits');
 assert.ok(await p.locator('[data-assignee-select]').isVisible());
 if(shotDir){await p.screenshot({path:resolve(shotDir,'assignee-filter-mobile.png')});await p.setViewportSize({width:1440,height:960});await p.screenshot({path:resolve(shotDir,'assignee-filter-desktop.png')});}
 // Filtering other lists does not hide urgent work on the main dashboard.
 await p.locator('.view-tabs [data-view=home]').click();await p.locator('[data-all-tasks]').click();
 await p.locator('[data-home-assignee]').selectOption('email:boss@example.test');
 assert.deepEqual(await p.locator('[data-select]').evaluateAll(xs=>xs.map(x=>x.dataset.select).sort()),['later','review']);
 await p.locator('.wf-filters [data-filter=today]').click();assert.deepEqual(await p.locator('[data-select]').evaluateAll(xs=>xs.map(x=>x.dataset.select)),['review']);
 await p.locator('[data-home-assignee]').selectOption('unassigned');assert.deepEqual(await p.locator('[data-select]').evaluateAll(xs=>xs.map(x=>x.dataset.select)),['inbox']);
 assert.deepEqual(a.calls,[],'filters must not write workspace data');assert.deepEqual(a.errors,[]);await a.context.close();
 const member=await setup('member',390);await member.page.locator('[data-place=work]').click();await member.page.locator('[data-assignee-select]').selectOption('email:boss@example.test');assert.equal(await member.page.locator('.task-table [data-task]').count(),2);assert.equal(await member.page.locator('[data-quick]').count(),0);assert.equal(await member.page.locator('.view-tabs [data-view=docs]').count(),0);assert.deepEqual(member.errors,[]);await member.context.close();
 console.log('PASS assignee filters: project + person + scope + search, co-executors, unassigned, back/reload, mobile, team list and unchanged member controls');
}finally{await browser.close();await new Promise(r=>server.close(r));}
