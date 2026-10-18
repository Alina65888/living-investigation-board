// Real PHP/SQLite API + browser checks, using isolated synthetic accounts and a test signature.
// BASE=http://127.0.0.1:8790 PLAYWRIGHT_MODULE=... CHROMIUM_EXECUTABLE=... node test/letters.browser.mjs
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE||'http://127.0.0.1:8790';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
const dir=process.env.LETTER_SHOTS||'/tmp/letter-qa';await mkdir(dir,{recursive:true});
const boss=await browser.newContext(),member=await browser.newContext(),other=await browser.newContext(),anon=await browser.newContext();
async function call(ctx,path,body,status=200){const r=await ctx.request.fetch(base+path,{method:body?'POST':'GET',...(body?{data:body}:{}),timeout:60000});const text=await r.text();assert.equal(r.status(),status,path+' '+text.slice(0,350));return r.headers()['content-type']?.includes('json')?JSON.parse(text):text;}
const errors=[];
try{
 await call(boss,'/api/setup',{name:'Руководитель Тест',email:'boss@example.com',password:'boss-password-1'});
 for(const [ctx,email,name] of [[member,'member@example.test','Исполнитель Тест'],[other,'other@example.test','Другой участник']]){const x=await call(boss,'/api/team',{name,email,role:'member',active:true});await call(ctx,'/api/login',{email,password:x.tempPassword});await call(ctx,'/api/password',{next:'member-password-1'});}
 await call(anon,'/api/letters',null,401);await call(member,'/api/letter-signature',null,403);
 const templates=await call(member,'/api/letter-templates');assert.equal(templates[0].id,'mant-v1');assert.ok(templates[0].defaults.body.startsWith('за активное участие'));assert.ok(!templates[0].defaults.body.includes('<'));
 await call(member,'/api/letter-templates',{name:'Bad',html:'x'},403);
 const p=await member.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(base+'/letters.html');await p.getByRole('heading',{name:'Благодарственные письма',exact:true}).waitFor();
 assert.equal(await p.locator('[data-tab="signature"]').count(),0);
 await p.locator('[data-new]').click();await p.locator('[data-use="mant-v1"]').click();await p.locator('[name=recipients]').fill('Иванову Ивану Ивановичу\nПетровой Анне Сергеевне');await p.locator('[name=title]').fill('Письма участникам проекта');await p.locator('[name=orderNumber]').fill('15');await p.locator('[name=orderDate]').fill('2026-03-02');await p.locator('[data-save]').click();
 await p.waitForFunction(()=>document.querySelector('[data-save-info]')?.textContent==='Все изменения сохранены');
 const id=new URL(p.url()).searchParams.get('letter');let l=await call(member,'/api/letters?id='+id);assert.equal(l.fields.recipients.length,2);
 let html=await call(member,`/api/letter-render?id=${id}&revision=${l.revision}`);assert.ok(html.includes('«02» марта 2026'));assert.ok(!html.includes('alt="Подпись"'));
 await call(member,`/api/letter-render?id=${id}&revision=${l.revision}&mode=print`,null,403);await call(other,'/api/letters?id='+id,null,403);
 await call(member,'/api/letters',{action:'approve',id,revision:l.revision},403);
 await call(member,'/api/letters',{action:'save',id,revision:1,title:'stale',fields:l.fields},409);
 await p.locator('[data-letter-form] [type=submit]').click();await p.locator('.status.pending').waitFor();l=await call(member,'/api/letters?id='+id);assert.equal(l.status,'pending');
 await call(member,'/api/letters',{action:'save',id,revision:l.revision,title:'edited',fields:l.fields},409);
 await call(boss,'/api/letters',{action:'approve',id,revision:l.revision},400);
 await call(boss,'/api/letters',{action:'return',id,revision:l.revision,note:''},400);
 l=await call(boss,'/api/letters',{action:'return',id,revision:l.revision,note:'Уточните текст благодарности'});assert.equal(l.status,'returned');
 await p.reload();await p.locator('p.note').filter({hasText:'Уточните текст благодарности'}).waitFor();await p.locator('[data-letter-form] [type=submit]').click();await p.locator('.status.pending').waitFor();
 const ap=await boss.newPage();ap.on('pageerror',e=>errors.push(e.message));ap.on('dialog',d=>d.accept());await ap.goto(base+'/letters.html?letter='+id);
 await ap.locator('[data-approve]').click();await ap.locator('.dialog [name=signerName]').fill('Тестовый Подписант');
 const png=await ap.evaluate(()=>{const c=document.createElement('canvas');c.width=480;c.height=160;const x=c.getContext('2d');x.font='italic 65px cursive';x.fillStyle='#203d72';x.fillText('TEST',50,100);return c.toDataURL('image/png')});
 await ap.locator('.dialog input[type=file]').setInputFiles({name:'test-signature.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await ap.locator('.dialog [type=submit]').click();await ap.locator('.status.approved').waitFor();
 l=await call(member,'/api/letters?id='+id);assert.equal(l.status,'approved');assert.equal(l.approval.signerName,'Тестовый Подписант');assert.ok(!('image' in l.approval));assert.equal(l.history[0].action,'approve');
 html=await call(member,`/api/letter-render?id=${id}&revision=${l.revision}&mode=print`);assert.equal((html.match(/class="letter-wrap"/g)||[]).length,2);assert.equal((html.match(/alt="Подпись"/g)||[]).length,2);assert.ok(html.includes('Тестовый Подписант'));assert.ok(!html.includes('Черновик · без подписи'));
 const printPage=await member.newPage();await printPage.goto(base+`/api/letter-render?id=${id}&revision=${l.revision}&mode=print`);await printPage.evaluate(()=>document.fonts.ready);assert.equal(await printPage.locator('#letter-print').isEnabled(),true,'approved pages fit and allow printing');await printPage.setViewportSize({width:1180,height:940});await printPage.screenshot({path:dir+'/signed-print.png',fullPage:true});await printPage.pdf({path:dir+'/signed-print.pdf',preferCSSPageSize:true,printBackground:true});
 assert.equal(await printPage.evaluate(()=>{try{localStorage.setItem('x','x');return true}catch{return false}}),false,'print page has opaque sandbox origin');
 const printResponse=await member.request.get(base+`/api/letter-render?id=${id}&revision=${l.revision}&mode=print`);assert.match(printResponse.headers()['content-security-policy'],/sandbox allow-scripts allow-modals/);
 await call(boss,'/api/letter-signature',{image:png,signerName:'Новый Подписант',signerRole:'Другая должность'});html=await call(member,`/api/letter-render?id=${id}&revision=${l.revision}&mode=print`);assert.ok(html.includes('Тестовый Подписант'));assert.ok(!html.includes('Новый Подписант'),'old approval keeps its signature metadata');
 await p.reload();await p.locator('[data-print]').waitFor();await p.setViewportSize({width:390,height:844});await p.frameLocator('[data-preview]').locator('[data-field=recipient]').waitFor();await p.locator('[data-preview]').scrollIntoViewIfNeeded();await p.waitForTimeout(150);await p.screenshot({path:dir+'/letters-mobile.png',fullPage:true});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page fits');
 await p.locator('[data-revise]').click();await p.locator('.status.draft').waitFor();const revised=await call(member,'/api/letters?id='+id);assert.equal(revised.approval,null);await call(member,`/api/letter-render?id=${id}&revision=${l.revision}&mode=print`,null,409);await call(member,`/api/letter-render?id=${id}&revision=${revised.revision}&mode=print`,null,403);
 await call(boss,'/api/letters',{action:'approve',id,revision:l.revision},409);await p.locator('[name=body]').fill('Строка благодарности\n'.repeat(100));await p.locator('[data-preview-status]').filter({hasText:'Текст не помещается'}).waitFor();assert.equal(await p.locator('[data-letter-form] [type=submit]').isDisabled(),true);await p.locator('[name=body]').fill(revised.fields.body);await p.locator('[data-letter-form] [type=submit]').waitFor();await p.waitForFunction(()=>!document.querySelector('[data-letter-form] [type=submit]').disabled);
 const malicious='<style>@import url("https://example.invalid/track");.page{width:1123px;height:794px}</style><div class="page"><script>parent.hacked=true</script><iframe src="/api/letters"></iframe><img src="https://example.invalid/track" onerror="parent.hacked=true"><meta http-equiv="refresh" content="0;url=https://example.invalid"><p>{{recipient}}</p><p>{{body}}</p><p>{{order}}</p><div>{{signerRole}} {{signature}} {{signerName}}</div></div>';
 const custom=await call(boss,'/api/letter-templates',{name:'Тестовый макет',html:malicious,orientation:'landscape'});const preview=await call(member,'/api/letter-preview',{templateId:custom.id,fields:{recipients:['<script>alert(1)</script>'],body:'Текст',orderDate:'2026-01-01',orderNumber:'1'}});assert.ok(!preview.html.includes('parent.hacked'));assert.ok(!preview.html.includes('<iframe'));assert.ok(!preview.html.includes('http-equiv="refresh"'));assert.ok(preview.html.includes('&lt;script&gt;'));
 const sp=await member.newPage();await sp.goto(base+'/letters.html');let outgoing=[],blocked=[];sp.on('response',r=>{if(r.url().includes('example.invalid'))outgoing.push(r.url())});sp.on('requestfailed',r=>{if(r.url().includes('example.invalid'))blocked.push(r.failure()?.errorText)});await sp.locator('[data-tab="library"]').click();await sp.locator(`[data-template-preview="${custom.id}"]`).click();await sp.locator('.dialog iframe').waitFor();await sp.waitForTimeout(600);assert.deepEqual(outgoing,[]);assert.ok(blocked.every(x=>/csp/i.test(x)),JSON.stringify(blocked));assert.equal(await sp.evaluate(()=>window.hacked),undefined);
 await call(boss,'/api/letter-templates',{name:'Без полей',html:'<p>Текст</p>'},400);
 await call(member,'/api/letter-preview',{templateId:'mant-v1',fields:{recipients:['Тест'],orderDate:'2026-02-31'}},400);
 await call(member,'/api/letter-preview',{templateId:'mant-v1',fields:{recipients:Array(51).fill('Тест')}},400);
 if(process.env.LETTER_SOURCE){const original=await readFile(process.env.LETTER_SOURCE,'utf8');const imported=await call(boss,'/api/letter-templates',{name:'Загруженный образец МАНТ',html:original,orientation:'landscape'});const ts=await call(boss,'/api/letter-templates');const sample=ts.find(t=>t.id===imported.id);assert.ok(sample.defaults.body.startsWith('за активное участие'));assert.equal(sample.defaults.signerName,'В. В. Шаталов');}
 assert.deepEqual(errors,[]);console.log('PASS letters: library, draft, live preview, submission, return, signature upload, approval, print/PDF, revision conflict, revoke, immutable approval snapshot, permissions, malicious HTML isolation, mobile');
}finally{await browser.close()}
