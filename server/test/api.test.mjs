// End-to-end check of the team API against a running server on an empty database:
//   public/api/config.php with admin_email boss@example.com, then `npm run dev`
//   BASE=http://127.0.0.1:8788 npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ADMIN = { name: 'Алина Руководитель', email: 'boss@example.com', password: 'boss-password-1' };

function client() {
  let jar = '';
  const call = async (path, body, { raw = false, form } = {}) => {
    const r = await fetch(BASE + path, {
      method: body || form ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar ? { Cookie: jar } : {}) },
      body: form || (body ? JSON.stringify(body) : undefined)
    });
    const set = r.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    if (raw) return r;
    const data = await r.json();
    return { status: r.status, data };
  };
  return call;
}
const boss = client(), anna = client(), ivan = client(), stranger = client();
let annaTemp, ivanTemp, rev;

test('first administrator: only the configured email', async () => {
  assert.equal((await boss('/api/me')).data.setup, true);
  assert.equal((await stranger('/api/setup', { name: 'X', email: 'hacker@example.com', password: 'whatever-123' })).status, 403);
  assert.equal((await boss('/api/setup', { ...ADMIN })).status, 200);
  const me = (await boss('/api/me')).data.me;
  assert.equal(me.role, 'admin');
  assert.equal((await stranger('/api/setup', { name: 'X', email: ADMIN.email, password: 'another-pass' })).status, 403, 'setup closes after the first account');
});

test('login rejects wrong password and anonymous API use', async () => {
  assert.equal((await stranger('/api/login', { email: ADMIN.email, password: 'nope-nope' })).status, 401);
  assert.equal((await stranger('/api/workspace')).status, 401);
});

test('admin adds people and gets temporary passwords', async () => {
  const a = await boss('/api/team', { name: 'Анна', email: 'Anna@Example.com', role: 'member', active: true });
  assert.equal(a.status, 200); annaTemp = a.data.tempPassword; assert.match(annaTemp, /^[a-z0-9]{5}-[a-z0-9]{5}$/);
  ivanTemp = (await boss('/api/team', { name: 'Иван', email: 'ivan@example.com', role: 'member', active: true })).data.tempPassword;
  assert.equal((await anna('/api/team', { name: 'x', email: 'x@example.com' })).status, 401);
  const team = (await boss('/api/workspace')).data.team;
  assert.equal(team.find(m => m.email === 'anna@example.com').pending, true);
});

test('member must replace the temporary password', async () => {
  assert.equal((await anna('/api/login', { email: 'anna@example.com', password: annaTemp })).status, 200);
  assert.equal((await anna('/api/me')).data.me.mustChange, true);
  assert.equal((await anna('/api/workspace')).status, 403);
  assert.equal((await anna('/api/password', { next: 'short' })).status, 400);
  assert.equal((await anna('/api/password', { next: 'anna-password-1' })).status, 200);
  assert.equal((await anna('/api/workspace')).status, 200);
  await ivan('/api/login', { email: 'ivan@example.com', password: ivanTemp });
  await ivan('/api/password', { next: 'ivan-password-1' });
});

test('admin saves the workspace; people are linked by name', async () => {
  const cur = (await boss('/api/workspace')).data;
  const data = { projects: [{ id: 'p1', name: 'Запуск' }], stages: [], relations: [], milestones: [], organizations: [], tasks: [
    { id: 't1', title: 'Макеты', projectId: 'p1', status: 'planned', assignee: 'Анна', dueDate: '2026-10-01', progress: 0, checklist: [{ text: 'эскиз', done: false }] },
    { id: 't2', title: 'Печать', projectId: 'p1', status: 'planned', assignee: 'Иван', progress: 0, checklist: [] }
  ] };
  const r = await boss('/api/workspace', { action: 'sync', data, revision: cur.revision });
  assert.equal(r.status, 200); rev = r.data.revision;
  const t1 = r.data.data.tasks.find(t => t.id === 't1');
  assert.deepEqual(t1.assigneeEmails, ['anna@example.com']);
  const notes = (await anna('/api/notifications')).data;
  assert.ok(notes.some(n => n.message.includes('Вам назначена задача «Макеты»')));
});

test('member changes only what is allowed on own tasks', async () => {
  const ws = (await anna('/api/workspace')).data.data;
  const t1 = ws.tasks.find(t => t.id === 't1'), t2 = ws.tasks.find(t => t.id === 't2');
  t1.status = 'doing'; t1.progress = 40; t1.title = 'Взлом'; t1.checklist[0].done = true;
  t2.status = 'doing';
  ws.tasks.push({ id: 't3', title: 'Моя идея', projectId: 'p1', status: 'done', assignee: 'Иван' });
  const r = await anna('/api/workspace', { action: 'sync', data: ws, revision: 0 });
  assert.equal(r.status, 200);
  const saved = r.data.data.tasks, s1 = saved.find(t => t.id === 't1'), s2 = saved.find(t => t.id === 't2'), s3 = saved.find(t => t.id === 't3');
  assert.equal(s1.status, 'doing'); assert.equal(s1.progress, 40); assert.equal(s1.title, 'Макеты'); assert.equal(s1.checklist[0].done, true);
  assert.equal(s2.status, 'planned', 'someone else’s task stays untouched');
  assert.equal(s3.status, 'planned'); assert.deepEqual(s3.assigneeEmails, ['anna@example.com']); assert.equal(s3.requiresReview, false, 'own tasks are closed without review');
});

test('stale admin save keeps the member’s change and new tasks', async () => {
  const data = { projects: [{ id: 'p1', name: 'Запуск' }], stages: [], relations: [], milestones: [], organizations: [], tasks: [
    { id: 't1', title: 'Макеты (v2)', projectId: 'p1', status: 'planned', assignee: 'Анна', dueDate: '2026-10-01', progress: 0, checklist: [{ text: 'эскиз', done: false }] },
    { id: 't2', title: 'Печать', projectId: 'p1', status: 'planned', assignee: 'Иван', dueDate: '2026-10-05', progress: 0, checklist: [] }
  ] };
  const r = await boss('/api/workspace', { action: 'sync', data, revision: rev });
  const tasks = r.data.data.tasks, t1 = tasks.find(t => t.id === 't1');
  assert.equal(t1.status, 'doing'); assert.equal(t1.progress, 40);
  assert.ok(tasks.some(t => t.id === 't3'), 'task created by the member survives');
  assert.equal(tasks.find(t => t.id === 't2').dueDate, '2026-10-05', 'admin edit on an untouched task applies');
  assert.ok((await ivan('/api/notifications')).data.some(n => n.message.includes('Срок задачи «Печать»')));
  rev = r.data.revision;
});

test('files, submit for review, return and accept', async () => {
  const form = new FormData(); form.append('taskId', 't1'); form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'отчёт.txt');
  const up = await anna('/api/task-files', null, { form });
  assert.equal(up.status, 200);
  const blocked = new FormData(); blocked.append('taskId', 't2'); blocked.append('file', new Blob(['x']), 'x.txt');
  assert.equal((await anna('/api/task-files', null, { form: blocked })).status, 403);
  assert.equal((await anna('/api/task-actions', { action: 'submit', id: 't1', text: 'Готово', url: 'https://example.com', fileIds: [up.data.id], review: true })).status, 200);
  let t1 = (await boss('/api/workspace')).data.data.tasks.find(t => t.id === 't1');
  assert.equal(t1.status, 'approval');
  assert.ok((await boss('/api/notifications')).data.some(n => n.message.includes('сдал(а) результат')));
  assert.equal((await anna('/api/task-actions', { action: 'accept', id: 't1' })).status, 403);
  await boss('/api/task-actions', { action: 'return', id: 't1', note: 'Добавьте обложку' });
  t1 = (await anna('/api/workspace')).data.data.tasks.find(t => t.id === 't1');
  assert.equal(t1.status, 'doing'); assert.equal(t1.result.review.decision, 'return');
  await anna('/api/task-actions', { action: 'submit', id: 't1', text: 'С обложкой', fileIds: [], review: true });
  await boss('/api/task-actions', { action: 'accept', id: 't1', note: 'Спасибо' });
  t1 = (await anna('/api/workspace')).data.data.tasks.find(t => t.id === 't1');
  assert.equal(t1.status, 'done'); assert.equal(t1.progress, 100);
  const files = (await boss('/api/task-files?taskId=t1')).data;
  const dl = await boss('/api/task-files?id=' + files[0].id, null, { raw: true });
  assert.equal(await dl.text(), 'hello');
  const history = (await anna('/api/task-thread?id=t1')).data.map(x => x.body);
  assert.ok(history.some(b => b.startsWith('Результат принят')));
});

test('one tap closes a task; review only when the manager asks for it', async () => {
  const sync = async (who, edit) => { const ws = (await who('/api/workspace')).data; edit(ws.data); return (await who('/api/workspace', { action: 'sync', data: ws.data, revision: ws.revision })).data.data; };
  let t2 = (await sync(ivan, d => { d.tasks.find(t => t.id === 't2').status = 'done'; })).tasks.find(t => t.id === 't2');
  assert.equal(t2.status, 'done'); assert.equal(t2.progress, 100);
  t2 = (await sync(ivan, d => { d.tasks.find(t => t.id === 't2').status = 'doing'; })).tasks.find(t => t.id === 't2');
  assert.equal(t2.status, 'doing', 'the executor can reopen a task closed by mistake');
  await boss('/api/task-actions', { action: 'assign', ids: ['t2'], patch: { requiresReview: true } });
  t2 = (await sync(ivan, d => { d.tasks.find(t => t.id === 't2').status = 'done'; })).tasks.find(t => t.id === 't2');
  assert.equal(t2.status, 'approval', 'a task with mandatory review goes to the manager');
  assert.ok((await boss('/api/notifications')).data.some(n => n.message.includes('нужна проверка')));
  const plain = await ivan('/api/task-actions', { action: 'submit', id: 't3', text: 'x' });
  assert.equal(plain.status, 403, 'submit stays limited to own tasks');
});

test('a first name in tasks links to the account; calendar events are kept', async () => {
  const cur = (await boss('/api/workspace')).data;
  cur.data.tasks.push({ id: 't4', title: 'Площадка', projectId: 'p1', status: 'planned', assignee: 'Мария', progress: 0, checklist: [] });
  cur.data.events = [{ id: 'e1', title: 'Репетиция', date: '2026-11-20', time: '18:00' }];
  const saved = (await boss('/api/workspace', { action: 'sync', data: cur.data, revision: cur.revision })).data.data;
  assert.equal(saved.tasks.find(t => t.id === 't4').assigneeEmails.length, 0);
  assert.equal(saved.events[0].title, 'Репетиция');
  await boss('/api/team', { name: 'Мария Петрова', email: 'maria@example.com', role: 'member', active: true });
  let ws = (await boss('/api/workspace')).data;
  const t4 = ws.data.tasks.find(t => t.id === 't4');
  assert.equal(t4.assignee, 'Мария Петрова'); assert.deepEqual(t4.assigneeEmails, ['maria@example.com']);
  const member = (await anna('/api/workspace')).data;
  await anna('/api/workspace', { action: 'sync', data: { ...member.data, events: [] }, revision: member.revision });
  ws = (await boss('/api/workspace')).data;
  assert.equal(ws.data.events.length, 1, 'members cannot remove events');
  const { events, ...old } = ws.data;
  await boss('/api/workspace', { action: 'sync', data: old, revision: ws.revision });
  assert.equal((await boss('/api/workspace')).data.data.events.length, 1, 'a page without events keeps them');
});

test('comments, problems and notifications', async () => {
  const req = crypto.randomUUID();
  await anna('/api/task-thread', { id: 't3', text: 'Нужен бриф', requestId: req });
  await anna('/api/task-thread', { id: 't3', text: 'Нужен бриф', requestId: req });
  assert.equal((await boss('/api/task-thread?id=t3')).data.filter(x => x.body === 'Нужен бриф').length, 1, 'retries are not duplicated');
  await ivan('/api/problems', { title: 'Нет доступа к типографии', detail: '...' });
  assert.equal((await anna('/api/problems')).data.length, 0, 'members see only their own problems');
  const all = (await boss('/api/problems')).data; assert.equal(all.length, 1);
  await boss('/api/problems', { id: all[0].id, status: 'resolved', response: 'Дала доступ' });
  assert.equal((await ivan('/api/problems')).data[0].response, 'Дала доступ');
  await ivan('/api/notifications', { all: true });
  assert.ok((await ivan('/api/notifications')).data.every(n => n.read_at));
});

test('deadline decisions are atomic, permission checked, and protect a newer date', async () => {
  let ws=(await boss('/api/workspace')).data;
  ws.data.tasks.push({id:'deadline-test',title:'Согласование срока',status:'doing',assignee:'Анна',dueDate:'2026-10-10',startDate:'2026-10-01',checklist:[],progress:0});
  await boss('/api/workspace',{action:'sync',data:ws.data,revision:ws.revision});
  const request={title:'Не успеваю',detail:'Жду площадку',taskId:'deadline-test',reason:'deadline',proposedDate:'2026-10-15'};
  assert.equal((await ivan('/api/problems',request)).status,403);
  assert.equal((await anna('/api/problems',{...request,proposedDate:'2026-02-31'})).status,400);
  assert.equal((await anna('/api/problems',request)).status,200);
  assert.equal((await anna('/api/problems',request)).status,409);
  let p=(await anna('/api/problems')).data.find(x=>x.task_id==='deadline-test');
  assert.equal(p.proposed_date,'2026-10-15');assert.equal(p.original_due,'2026-10-10');
  assert.equal((await anna('/api/problems',{id:p.id,decision:'approve'})).status,403);
  assert.equal((await boss('/api/problems',{id:p.id,version:p.response_version,decision:'approve',date:'2026-10-16'})).status,200);
  assert.equal((await boss('/api/workspace')).data.data.tasks.find(t=>t.id==='deadline-test').dueDate,'2026-10-16');
  p=(await anna('/api/problems')).data.find(x=>x.id===p.id);assert.equal(p.status,'resolved');assert.equal(p.decision,'approve');assert.equal(p.response_read,false);
  assert.equal((await boss('/api/problems',{id:p.id,decision:'approve'})).status,409);
  assert.equal((await ivan('/api/problems',{id:p.id,action:'read',version:p.response_version})).status,403);
  assert.equal((await anna('/api/problems',{id:p.id,action:'read',version:p.response_version})).status,200);
  assert.equal((await anna('/api/problems')).data.find(x=>x.id===p.id).response_read,true);
  await boss('/api/problems',{id:p.id,status:'resolved',response:'Уточнение решения'});
  assert.equal((await anna('/api/problems')).data.find(x=>x.id===p.id).response_read,false);
  assert.equal((await anna('/api/problems',{id:p.id,action:'read',version:p.response_version})).status,409);
  await anna('/api/problems',{...request,proposedDate:'2026-10-20'});
  p=(await anna('/api/problems')).data.find(x=>x.task_id==='deadline-test'&&x.status==='open');
  await boss('/api/task-actions',{action:'assign',ids:['deadline-test'],patch:{dueDate:'2026-10-18'}});
  assert.equal((await boss('/api/problems',{id:p.id,decision:'approve'})).status,409);
  assert.equal((await boss('/api/problems')).data.find(x=>x.id===p.id).status,'open');
  assert.equal((await boss('/api/workspace')).data.data.tasks.find(t=>t.id==='deadline-test').dueDate,'2026-10-18');
  assert.equal((await boss('/api/problems',{id:p.id,decision:'reject',response:''})).status,400);
  assert.equal((await boss('/api/problems',{id:p.id,decision:'reject',response:'Оставляем согласованную дату'})).status,200);
});

test('archive and restore keep links', async () => {
  const ws = (await boss('/api/workspace')).data;
  ws.data.relations = [{ id: 'r1', sourceId: 't2', targetId: 't3', type: 'blocks' }];
  rev = (await boss('/api/workspace', { action: 'sync', data: ws.data, revision: ws.revision })).data.revision;
  await boss('/api/task-actions', { action: 'archive', id: 't2' });
  let d = (await boss('/api/workspace')).data.data;
  assert.ok(!d.tasks.some(t => t.id === 't2')); assert.equal(d.relations.length, 0); assert.equal(d.archive[0].id, 't2');
  // a stale admin save must not bring the archived task back
  const stale = structuredClone(ws.data); stale.relations = [];
  await boss('/api/workspace', { action: 'sync', data: stale, revision: rev });
  d = (await boss('/api/workspace')).data.data;
  assert.ok(!d.tasks.some(t => t.id === 't2'), 'archived task stays archived');
  await boss('/api/task-actions', { action: 'restore', id: 't2' });
  d = (await boss('/api/workspace')).data.data;
  assert.ok(d.tasks.some(t => t.id === 't2')); assert.equal(d.relations.length, 1);
});

test('documents storage is for administrators only and refuses stale writes', async () => {
  const first = await boss('/api/docs');
  assert.equal(first.status, 200); assert.equal(first.data.data, null);
  const saved = await boss('/api/docs', { data: { version: 1, parties: [{ id: 'x', kind: 'npd', fio: 'Тест', passport: '0000 000000' }], deals: [] }, revision: first.data.revision });
  assert.equal(saved.status, 200);
  assert.equal((await boss('/api/docs', { data: { version: 1, parties: [], deals: [] }, revision: first.data.revision })).status, 409, 'stale revision');
  assert.equal((await boss('/api/docs')).data.data.parties[0].fio, 'Тест');
  assert.equal((await anna('/api/docs')).status, 403, 'members never see passports and bank details');
  assert.equal((await stranger('/api/docs')).status, 401);
});

test('quick assignment preserves helpers; explicit contributor changes still apply', async () => {
  await boss('/api/task-actions', { action: 'assign', ids: ['t1'], patch: { lead: 'Анна', contributors: ['Иван'] } });
  await boss('/api/task-actions', { action: 'assign', ids: ['t1', 't2'], patch: { lead: ADMIN.name } });
  let t = (await boss('/api/workspace')).data.data.tasks.find(t => t.id === 't1');
  assert.deepEqual(t.contributors, ['Иван']);
  assert.ok(t.assigneeEmails.includes('ivan@example.com'));
  const before = structuredClone(t);
  await boss('/api/task-actions', { action: 'assign', ids: ['t1'], patch: { dueDate: '2027-01-12' } });
  t = (await boss('/api/workspace')).data.data.tasks.find(t => t.id === 't1');
  assert.equal(t.dueDate, '2027-01-12');assert.equal(t.status, before.status);assert.deepEqual(t.contributors, before.contributors);
  await boss('/api/task-actions', { action: 'assign', ids: ['t1'], patch: { lead: ADMIN.name, contributors: [] } });
  assert.deepEqual((await boss('/api/workspace')).data.data.tasks.find(t => t.id === 't1').contributors, []);
});

test('password reset, deactivation, last admin and logout', async () => {
  const reset = await boss('/api/team', { name: 'Иван', email: 'ivan@example.com', role: 'member', active: true, resetPassword: true });
  assert.ok(reset.data.tempPassword);
  assert.equal((await ivan('/api/workspace')).status, 401, 'reset signs the person out');
  await boss('/api/team', { name: 'Анна', email: 'anna@example.com', role: 'member', active: false });
  assert.equal((await anna('/api/workspace')).status, 401);
  assert.equal((await anna('/api/login', { email: 'anna@example.com', password: 'anna-password-1' })).status, 401);
  assert.equal((await boss('/api/team', { name: ADMIN.name, email: ADMIN.email, role: 'member', active: true })).status, 400);
  assert.equal((await boss('/api/logout', {})).status, 200);
  assert.equal((await boss('/api/workspace')).status, 401);
});

test('cross-site POST is refused', async () => {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }) });
  assert.equal(r.status, 403);
});
