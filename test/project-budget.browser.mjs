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

try{
 const mobile=await setup('admin',390),p=mobile.page;
 await p.locator('[data-view="docs"]').click();
 await p.locator('[data-folder="mant-pearl"]').click();await p.locator('[data-new-estimate]').click();
 assert.equal(await p.locator('[data-budget-format]').inputValue(),'subsidy');
 await p.locator('[data-budget-field=year]').fill('2026');
 await p.locator('[data-budget-add]').click();
 await p.locator('[data-budget-it=name]').fill('Руководитель проекта');
 await p.locator('[data-budget-it=description]').fill('Координация работы команды и исполнителей');
 await p.locator('[data-budget-it=unit]').fill('месяц');await p.locator('[data-budget-it=qty]').fill('2');await p.locator('[data-budget-it=price]').fill('10000');
 await p.locator('[data-budget-select]').check();
 const dl=p.waitForEvent('download');await p.locator('[data-budget-download]').click();const estimate=await dl;assert.equal(estimate.suggestedFilename(),'Смета 2026 (ЖМ).docx');assert.equal(await estimate.failure(),null);
 if(shotDir){await estimate.saveAs(resolve(shotDir,'estimate.docx'));await p.screenshot({path:resolve(shotDir,'estimate-mobile.png'),fullPage:true});}
 await p.locator('[data-budget-create]').click();await p.locator('[data-f=executorId]').selectOption('exec');
 await p.locator('[data-step="2"]').click();
 assert.equal(await p.locator('[data-it=name]').inputValue(),'Руководитель проекта');assert.equal(await p.locator('[data-it=description]').inputValue(),'Координация работы команды и исполнителей');assert.equal(await p.locator('[data-it=qty]').inputValue(),'2');
 await p.locator('[data-f=number]').fill('1/ЖМ');await p.locator('[data-f=date]').fill('2026-03-01');
 await p.locator('[data-source-estimate]').click();
 assert.equal(await p.locator('[data-budget-select]').isDisabled(),true);
 await p.locator('[data-budget-it=price]').fill('12000');
 await p.locator('[data-budget-deal]').click();await p.locator('[data-step="2"]').click();assert.equal(await p.locator('[data-it=price]').inputValue(),'10000');
 await p.locator('[data-refresh-estimate]').click();assert.equal(await p.locator('[data-it=price]').inputValue(),'12000');
 await p.locator('[data-source-estimate]').click();await p.locator('[data-budget-view=register]').click();
 await p.getByText('Договор № 1/ЖМ от 01.03.2026',{exact:true}).waitFor();
 const reg=p.waitForEvent('download');await p.locator('[data-budget-download]').click();const registry=await reg;assert.equal(registry.suggestedFilename(),'Реестр 2026 (ЖМ).docx');assert.equal(await registry.failure(),null);
 if(shotDir){await registry.saveAs(resolve(shotDir,'registry.docx'));await p.screenshot({path:resolve(shotDir,'registry-mobile.png'),fullPage:true});}
 await p.reload();await p.locator('[data-reg-type=contract]').waitFor();assert.match(p.url(),/docMode=register/);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'register fits mobile');
 assert.equal(mobile.docs().estimates.length,2);assert.equal(mobile.docs().deals.length,1);assert.equal(mobile.docs().deals[0].items[0].price,12000);assert.deepEqual(mobile.errors,[]);
 console.log('PASS budget workflow: mobile form, Word, linked contract, explicit refresh, register, persistence');
 await mobile.context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
