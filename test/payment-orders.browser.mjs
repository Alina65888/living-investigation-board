// Synthetic API fixtures only. Exercises the real Documents UI and real XLS download.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {customer,npd,company,deal,project} from './payment-fixtures.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'../docs'),output=process.env.PP_OUTPUT||'/tmp/pp-ui';await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{let name=new URL(req.url,'http://localhost').pathname;if(name==='/')name='/index.html';const path=resolve(root,'.'+decodeURIComponent(name));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{
 for(const e of [npd,company,{...npd,kind:'ip'}]){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const me={name:'Администратор Тест',email:'admin@example.test',role:'admin',active:true};
  let docs={version:1,parties:[{...customer,own:true},e],deals:[{...deal,paymentNumber:'',paymentDate:'',folderId:'test',projectId:'p'}],folders:[{...project,id:'test',organization:'Тест'}],estimates:[]},revision=0;
  const data={organizations:[{id:'o',name:'Тест'}],projects:[{id:'p',name:project.name,orgId:'o'}],stages:[],tasks:[],events:[],relations:[],milestones:[],archive:[],meta:{demo:false}};
  await page.route('**/api/**',async route=>{const r=route.request(),path=new URL(r.url()).pathname;let b;try{b=r.postDataJSON()}catch{}let out;
   if(path==='/api/me')out={team:true,me,setup:false};
   else if(path==='/api/workspace')out={data,revision:1,me,team:[me]};
   else if(path==='/api/docs'){if(b){assert.equal(b.revision,revision);docs=b.data;out={revision:++revision};}else out={data:docs,revision};}
   else if(['/api/notifications','/api/problems'].includes(path))out=[];
   else throw Error('Unexpected API '+path);
   await route.fulfill({json:out});
  });
  await page.goto(base);await page.locator('[data-view="docs"]').click();await page.locator('[data-folder="test"]').click();await page.locator('[data-deal="d"]').click();
  assert.equal(await page.locator('[data-payment-panel]').isVisible(),false,'payment panel belongs only to Documents step');
  await page.locator('[data-step="3"]').click();await page.locator('[data-make="payment"]').click();assert.equal(await page.locator('[data-payment-panel]').getAttribute('open'),'');
  await page.locator('[data-f="paymentNumber"]').fill('29');await page.locator('[data-f="paymentDate"]').fill('2026-10-29');await page.locator('[data-f="paymentAmount"]').fill('6100');
  assert.match(await page.locator('[data-payment-preview]').textContent(),e.kind==='org'?/НДС 22% — 1100-00/:/Без налога/);
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/docs')&&r.request().method()==='POST');await page.locator('[data-f="paymentAmount"]').press('Tab');await saved;
  assert.equal(docs.deals[0].paymentAmount,'6100');assert.equal(docs.deals[0].paymentNumber,'29');assert.ok(!docs.deals[0].paid);
  const dl=page.waitForEvent('download');await page.locator('[data-make="payment"]').click();const download=await dl;assert.equal(await download.failure(),null);assert.match(download.suggestedFilename(),/2026.10.29 Платежное поручение № 29.*\(КНТ\)\.xls$/);await download.saveAs(output+'/'+e.kind+'.xls');
  await page.locator('[data-payment-panel]').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/'+e.kind+'-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.reload();await page.locator('[data-make="payment"]').waitFor();await page.locator('[data-payment-panel] summary').first().click();assert.equal(await page.locator('[data-f="paymentNumber"]').inputValue(),'29');
  await page.locator('[data-copy]').click();await page.locator('[data-step="3"]').click();await page.locator('[data-payment-panel] summary').first().click();assert.equal(await page.locator('[data-f="paymentNumber"]').inputValue(),'');assert.equal(await page.locator('[data-f="paymentDate"]').inputValue(),'');assert.equal(await page.locator('[data-f="paymentAmount"]').inputValue(),'');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS payment UI: org/IP/NPD, mobile, missing fields, partial amount/VAT, persistence, actual XLS download, filename, copy resets payment, no paid flag');
}finally{await browser.close();await new Promise(r=>server.close(r));}
