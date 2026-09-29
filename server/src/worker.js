// Living Project HQ — team server (Cloudflare Worker + D1 database + KV for attached files).
// Accounts with email + password, two roles (admin / member), the shared workspace and the team workflow.
// The static app in ../docs talks to it through /api/* (see docs/workspace-store.js).

const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const MAX_FILE = 10 * 1024 * 1024;
const LOGIN_LIMIT = 10, LOGIN_WINDOW = 15 * 60 * 1000;
const MEMBER_STATUSES = ['planned', 'doing', 'blocked'];
// Fields owned by the workflow (members, reviews). A stale admin save must not undo them.
const PROTECTED = ['status', 'progress', 'checklist', 'result', 'assignee', 'assignees', 'assigneeEmails', 'assigneeEmail', 'lead', 'contributors', 'requiresReview', 'dueDate', 'priority', 'title', 'description', 'expectedResult', 'updatedAt', 'updatedBy'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const normEmail = e => String(e || '').trim().toLowerCase();
const clip = (v, n) => String(v ?? '').slice(0, n);
const isDate = v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const splitNames = s => String(s || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
const ruDate = s => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'без срока';

// ---------- crypto ----------
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS }, key, 256));
}
function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function randomToken(bytes = 32) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const s = [...crypto.getRandomValues(new Uint8Array(10))].map(b => abc[b % abc.length]).join('');
  return s.slice(0, 5) + '-' + s.slice(5);
}
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) fail(400, 'Пароль должен быть не короче 8 символов');
  if (p.length > 200) fail(400, 'Слишком длинный пароль');
}
async function setPassword(env, email, password, mustChange) {
  const salt = randomToken(16);
  await env.DB.prepare('UPDATE users SET pw_hash=?, pw_salt=?, must_change=? WHERE email=?').bind(await hashPassword(password, salt), salt, mustChange ? 1 : 0, email).run();
}

// ---------- sessions ----------
function cookie(req, name) {
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}
function sessionCookie(req, token, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `lphq=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
async function startSession(req, env, email) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), email, Date.now() + SESSION_DAYS * 864e5),
    env.DB.prepare('UPDATE users SET last_login=? WHERE email=?').bind(now(), email)
  ]);
  return sessionCookie(req, token, SESSION_DAYS * 86400);
}
async function currentUser(req, env) {
  const token = cookie(req, 'lphq');
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare('SELECT u.email, u.name, u.role, u.must_change FROM sessions s JOIN users u ON u.email = s.email WHERE s.id = ? AND s.expires_at > ? AND u.active = 1').bind(await sha256(token), Date.now()).first();
}
async function tooManyAttempts(env, key) {
  const row = await env.DB.prepare('SELECT count, reset_at FROM login_attempts WHERE key=?').bind(key).first();
  return !!row && row.reset_at > Date.now() && row.count >= LOGIN_LIMIT;
}
async function countAttempt(env, key) {
  const t = Date.now();
  await env.DB.prepare(`INSERT INTO login_attempts (key, count, reset_at) VALUES (?1, 1, ?2)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at < ?3 THEN 1 ELSE count + 1 END, reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END`).bind(key, t + LOGIN_WINDOW, t).run();
}

// ---------- people ----------
const publicMe = u => ({ name: u.name, email: u.email, role: u.role, mustChange: !!u.must_change });
async function teamList(env) {
  const { results } = await env.DB.prepare('SELECT name, email, role, active, last_login FROM users ORDER BY name').all();
  return results.map(u => ({ name: u.name, email: u.email, role: u.role, active: u.active ? 1 : 0, pending: !!u.active && !u.last_login }));
}
async function adminEmails(env) {
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE role='admin' AND active=1").all();
  return results.map(r => r.email);
}
// Keeps assignee text, lead/contributors and the e-mails used for permissions in step.
function applyPeople(t, team) {
  const joined = [t.lead, ...(t.contributors || [])].filter(Boolean).join(', ');
  if ((t.assignee || '') !== joined) { const parts = splitNames(t.assignee); t.lead = parts[0] || ''; t.contributors = parts.slice(1); }
  const names = [t.lead, ...(t.contributors || [])].filter(Boolean);
  const byName = new Map(team.filter(m => m.active).map(m => [m.name.trim().toLowerCase(), m.email]));
  t.assignee = names.join(', ');
  t.assignees = names;
  t.assigneeEmails = [...new Set(names.map(n => byName.get(n.toLowerCase())).filter(Boolean))];
  t.assigneeEmail = t.assigneeEmails[0] || '';
  return t;
}
const canEdit = (t, me) => me.role === 'admin' || (t.assigneeEmails || []).includes(me.email) || t.assigneeEmail === me.email || t.createdBy === me.email;

// ---------- notifications & history ----------
function notify(list, emails, message, taskId, except) {
  for (const email of new Set(emails)) if (email && email !== except) list.push({ email, message, taskId });
}
async function flushNotes(env, notes) {
  if (!notes.length) return;
  const t = now();
  await env.DB.batch(notes.map(n => env.DB.prepare('INSERT INTO notifications (id, email, message, task_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(uid(), n.email, clip(n.message, 1000), n.taskId || null, t)));
}
async function history(env, taskId, author, body) {
  await env.DB.prepare('INSERT INTO thread (id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(uid(), taskId, author, clip(body, 5000), now()).run();
}
// Who hears about changes to a task: its people, and the admins for things that need a decision.
function peopleChanges(before, after, notes, actor) {
  const added = (after.assigneeEmails || []).filter(e => !(before?.assigneeEmails || []).includes(e));
  notify(notes, added, `Вам назначена задача «${after.title}»`, after.id, actor);
  if (before && (before.dueDate || '') !== (after.dueDate || '')) notify(notes, after.assigneeEmails || [], `Срок задачи «${after.title}» изменён: ${ruDate(after.dueDate)}`, after.id, actor);
}

// ---------- workspace ----------
async function loadWorkspace(env) {
  const row = await env.DB.prepare('SELECT data, revision FROM workspace WHERE id = 1').first();
  return row ? { data: JSON.parse(row.data), revision: row.revision } : { data: null, revision: 0 };
}
// Optimistic write: apply `fn` to the latest data and retry if someone saved in between.
async function mutate(env, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, revision } = await loadWorkspace(env);
    const next = revision + 1;
    const out = await fn(data ? structuredClone(data) : null, revision, next);
    if (!out) return { data, revision };
    const body = JSON.stringify(out);
    if (body.length > 20 * 1024 * 1024) fail(413, 'Рабочее пространство слишком большое');
    const res = revision === 0
      ? await env.DB.prepare('INSERT OR IGNORE INTO workspace (id, data, revision) VALUES (1, ?, ?)').bind(body, next).run()
      : await env.DB.prepare('UPDATE workspace SET data = ?, revision = ? WHERE id = 1 AND revision = ?').bind(body, next, revision).run();
    if (res.meta.changes === 1) return { data: out, revision: next };
  }
  fail(409, 'Общая база сейчас занята. Повторите через несколько секунд.');
}
function ensureShape(d) {
  d = d && typeof d === 'object' ? d : {};
  for (const k of ['projects', 'tasks', 'relations', 'stages', 'milestones', 'organizations', 'archive']) if (!Array.isArray(d[k])) d[k] = [];
  return d;
}
function mergeAdmin(server, incoming, base, current, next, team, notes, me) {
  const inc = ensureShape(incoming);
  const srv = ensureShape(server);
  const srvById = new Map(srv.tasks.map(t => [t.id, t]));
  if (base === current) {
    if (!Array.isArray(incoming.archive)) inc.archive = srv.archive;
  } else {
    const archivedLater = new Set(srv.archive.filter(a => (a._rev || 0) > base).map(a => a.id));
    inc.tasks = inc.tasks.filter(t => !archivedLater.has(t.id)).map(t => {
      const s = srvById.get(t.id);
      if (!s || (s._rev || 0) <= base) return t;
      const m = { ...t };
      for (const k of PROTECTED) { if (k in s) m[k] = s[k]; else delete m[k]; }
      m._rev = s._rev;
      return m;
    });
    const have = new Set(inc.tasks.map(t => t.id));
    for (const s of srv.tasks) if (!have.has(s.id) && (s._createdRev || 0) > base) inc.tasks.push(s);
    inc.archive = srv.archive;
  }
  for (const t of inc.tasks) {
    const before = srvById.get(t.id);
    if (!before) { t._createdRev = next; t.createdAt ||= now(); t.createdBy ||= me.email; }
    applyPeople(t, team);
    peopleChanges(before, t, notes, me.email);
  }
  return inc;
}
function mergeMember(server, incoming, next, team, notes, me, admins) {
  const srv = ensureShape(server);
  const srvById = new Map(srv.tasks.map(t => [t.id, t]));
  const projects = new Set(srv.projects.map(p => p.id));
  let touched = false;
  for (const t of Array.isArray(incoming?.tasks) ? incoming.tasks : []) {
    const s = srvById.get(t?.id);
    if (s) {
      if (!canEdit(s, me)) continue;
      let changed = false;
      if (t.status !== s.status && MEMBER_STATUSES.includes(t.status) && s.status !== 'done' && s.status !== 'approval') { s.status = t.status; changed = true; }
      const progress = Math.max(0, Math.min(100, Math.round(Number(t.progress))));
      if (Number.isFinite(progress) && progress !== (s.progress || 0)) { s.progress = progress; changed = true; }
      if (Array.isArray(t.checklist) && Array.isArray(s.checklist)) s.checklist.forEach((c, i) => { const x = t.checklist[i]; if (x && x.text === c.text && !!x.done !== !!c.done) { c.done = !!x.done; changed = true; } });
      if (changed) { Object.assign(s, { _rev: next, updatedAt: now(), updatedBy: me.email }); touched = true; }
    } else if (t && typeof t.id === 'string' && t.id.length <= 100 && String(t.title || '').trim()) {
      const projectId = projects.has(t.projectId) ? t.projectId : '';
      const stage = srv.stages.find(x => x.id === t.stageId && x.projectId === projectId);
      const nt = applyPeople({
        id: t.id, title: clip(t.title, 300).trim(), description: clip(t.description, 5000), projectId, stageId: stage ? stage.id : '',
        status: ['planned', 'doing'].includes(t.status) ? t.status : 'planned', priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
        startDate: isDate(t.startDate) ? t.startDate || '' : '', dueDate: isDate(t.dueDate) ? t.dueDate || '' : '', assignee: me.name, lead: me.name, contributors: [],
        requiresReview: true, createdBy: me.email, createdAt: now(), updatedAt: now(), progress: 0, checklist: [], inbox: !projectId, _createdRev: next, _rev: next
      }, team);
      srv.tasks.unshift(nt); touched = true;
      notify(notes, admins, `${me.name} добавил(а) задачу «${nt.title}»`, nt.id, me.email);
    }
  }
  return touched ? srv : null; // nothing to write: keep the revision as it is
}

// ---------- route handlers ----------
async function readJson(req) {
  if (!(req.headers.get('Content-Type') || '').includes('application/json')) fail(415, 'Ожидался JSON');
  try { return await req.json(); } catch { fail(400, 'Некорректный запрос'); }
}
const requireAdmin = me => { if (me.role !== 'admin') fail(403, 'Действие доступно администратору'); };

const AUTH_PATHS = new Set(['/api/me', '/api/setup', '/api/login', '/api/logout']);
async function handleAuth(path, req, env) {
  if (!AUTH_PATHS.has(path)) return null;
  if (path === '/api/me' && req.method === 'GET') {
    const me = await currentUser(req, env);
    const setup = !me && !(await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first());
    return json({ team: true, me: me ? publicMe(me) : null, setup });
  }
  if (req.method !== 'POST') fail(405, 'Метод не поддерживается');
  const body = await readJson(req);
  if (path === '/api/setup') {
    if (await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first()) fail(403, 'Администратор уже создан. Войдите со своим паролем.');
    const email = normEmail(body.email);
    if (!env.ADMIN_EMAIL || email !== normEmail(env.ADMIN_EMAIL)) fail(403, 'Этот email не указан как адрес администратора в настройках сервера.');
    const name = clip(body.name, 120).trim(); if (!name) fail(400, 'Укажите имя');
    checkPassword(body.password);
    await env.DB.prepare("INSERT INTO users (email, name, role, active, must_change, created_at) VALUES (?, ?, 'admin', 1, 0, ?)").bind(email, name, now()).run();
    await setPassword(env, email, body.password, false);
    return json({ ok: true }, 200, { 'Set-Cookie': await startSession(req, env, email) });
  }
  if (path === '/api/login') {
    const email = normEmail(body.email), ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (await tooManyAttempts(env, 'e:' + email) || await tooManyAttempts(env, 'ip:' + ip)) fail(429, 'Слишком много попыток. Подождите 15 минут.');
    const u = await env.DB.prepare('SELECT email, pw_hash, pw_salt, active FROM users WHERE email = ?').bind(email).first();
    const ok = u && u.active && u.pw_hash && safeEqual(await hashPassword(String(body.password || ''), u.pw_salt), u.pw_hash);
    if (!ok) { await countAttempt(env, 'e:' + email); await countAttempt(env, 'ip:' + ip); fail(401, 'Неверный email или пароль'); }
    await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind('e:' + email).run();
    return json({ ok: true }, 200, { 'Set-Cookie': await startSession(req, env, email) });
  }
  if (path === '/api/logout') {
    const token = cookie(req, 'lphq');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  return null;
}

async function handleApi(path, req, env, me) {
  const url = new URL(req.url);

  if (path === '/api/password' && req.method === 'POST') {
    const body = await readJson(req);
    const u = await env.DB.prepare('SELECT pw_hash, pw_salt, must_change FROM users WHERE email = ?').bind(me.email).first();
    if (!u.must_change && !safeEqual(await hashPassword(String(body.current || ''), u.pw_salt), u.pw_hash)) fail(400, 'Текущий пароль указан неверно');
    checkPassword(body.next);
    await setPassword(env, me.email, body.next, false);
    return json({ ok: true });
  }
  if (me.must_change) fail(403, 'Сначала задайте новый пароль');

  if (path === '/api/workspace') {
    if (req.method === 'GET') {
      const { data, revision } = await loadWorkspace(env);
      return json({ me: publicMe(me), team: await teamList(env), revision, data });
    }
    const body = await readJson(req);
    if (body.action !== 'sync' || !body.data || typeof body.data !== 'object') fail(400, 'Некорректный запрос');
    const team = await teamList(env), admins = await adminEmails(env), notes = [];
    const saved = await mutate(env, (server, current, next) => {
      notes.length = 0;
      return me.role === 'admin'
        ? mergeAdmin(server, structuredClone(body.data), Number(body.revision) || 0, current, next, team, notes, me)
        : mergeMember(server, body.data, next, team, notes, me, admins);
    });
    await flushNotes(env, notes);
    return json({ revision: saved.revision, data: saved.data });
  }

  if (path === '/api/team' && req.method === 'POST') {
    requireAdmin(me);
    const body = await readJson(req);
    const email = normEmail(body.email), name = clip(body.name, 120).trim(), role = body.role === 'admin' ? 'admin' : 'member', active = body.active === false ? 0 : 1;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Укажите корректный email');
    const existing = await env.DB.prepare('SELECT email, role, active FROM users WHERE email = ?').bind(email).first();
    if (existing && (role !== 'admin' || !active) && existing.role === 'admin') {
      const others = (await adminEmails(env)).filter(e => e !== email);
      if (!others.length) fail(400, 'Нельзя убрать последнего администратора');
    }
    let temp = null;
    if (!existing) {
      if (!name) fail(400, 'Укажите имя');
      await env.DB.prepare('INSERT INTO users (email, name, role, active, must_change, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(email, name, role, active, now()).run();
      temp = tempPassword(); await setPassword(env, email, temp, true);
    } else {
      await env.DB.prepare('UPDATE users SET name = COALESCE(NULLIF(?, \'\'), name), role = ?, active = ? WHERE email = ?').bind(name, role, active, email).run();
      if (body.resetPassword) { temp = tempPassword(); await setPassword(env, email, temp, true); }
      if (body.resetPassword || !active) await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
    }
    return json({ ok: true, tempPassword: temp });
  }

  if (path === '/api/problems') {
    if (req.method === 'GET') {
      const q = me.role === 'admin' ? env.DB.prepare('SELECT * FROM problems ORDER BY created_at DESC LIMIT 300') : env.DB.prepare('SELECT * FROM problems WHERE author = ? ORDER BY created_at DESC LIMIT 300').bind(me.email);
      return json((await q.all()).results);
    }
    const body = await readJson(req), t = now(), notes = [];
    if (body.id) {
      requireAdmin(me);
      const p = await env.DB.prepare('SELECT * FROM problems WHERE id = ?').bind(body.id).first();
      if (!p) fail(404, 'Проблема не найдена');
      const status = ['open', 'review', 'resolved'].includes(body.status) ? body.status : p.status;
      await env.DB.prepare('UPDATE problems SET status = ?, response = ?, updated_at = ? WHERE id = ?').bind(status, clip(body.response, 5000), t, p.id).run();
      notify(notes, [p.author], `Руководитель ответил: «${p.title}»`, p.task_id, me.email);
    } else {
      const title = clip(body.title, 300).trim(); if (!title) fail(400, 'Опишите проблему');
      await env.DB.prepare('INSERT INTO problems (id, title, detail, task_id, author, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'open\', ?, ?)').bind(uid(), title, clip(body.detail, 5000), body.taskId ? clip(body.taskId, 100) : null, me.email, t, t).run();
      notify(notes, await adminEmails(env), `${me.name} просит помощи: «${title}»`, body.taskId || null, me.email);
    }
    await flushNotes(env, notes);
    return json({ ok: true });
  }

  if (path === '/api/notifications') {
    if (req.method === 'GET') return json((await env.DB.prepare('SELECT id, message, task_id, created_at, read_at FROM notifications WHERE email = ? ORDER BY created_at DESC LIMIT 100').bind(me.email).all()).results);
    const body = await readJson(req);
    if (body.all) await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE email = ? AND read_at IS NULL').bind(now(), me.email).run();
    else if (body.id) await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE email = ? AND id = ?').bind(now(), me.email, body.id).run();
    return json({ ok: true });
  }

  if (path === '/api/task-thread') {
    if (req.method === 'GET') return json((await env.DB.prepare('SELECT author, body, created_at FROM thread WHERE task_id = ? ORDER BY created_at DESC LIMIT 200').bind(url.searchParams.get('id') || '').all()).results);
    const body = await readJson(req), text = clip(body.text, 5000).trim();
    if (!text) fail(400, 'Напишите комментарий');
    const { data } = await loadWorkspace(env), task = ensureShape(data).tasks.find(t => t.id === body.id);
    if (!task) fail(404, 'Задача не найдена');
    const res = await env.DB.prepare('INSERT OR IGNORE INTO thread (id, task_id, author, body, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(uid(), task.id, me.email, text, body.requestId ? clip(body.requestId, 100) : null, now()).run();
    if (res.meta.changes) {
      const notes = [];
      notify(notes, [...(task.assigneeEmails || []), ...(me.role === 'admin' ? [] : await adminEmails(env))], `${me.name} написал(а) в задаче «${task.title}»`, task.id, me.email);
      await flushNotes(env, notes);
    }
    return json({ ok: true });
  }

  if (path === '/api/task-files') {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const f = await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
        const body = f && await env.FILES.get(`tasks/${f.task_id}/${f.id}`, { type: 'stream' });
        if (!body) fail(404, 'Файл не найден');
        return new Response(body, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
      }
      return json((await env.DB.prepare('SELECT id, name, size, created_at FROM files WHERE task_id = ? ORDER BY created_at').bind(url.searchParams.get('taskId') || '').all()).results);
    }
    const form = await req.formData(), file = form.get('file'), taskId = clip(form.get('taskId'), 100);
    if (!file || typeof file === 'string') fail(400, 'Выберите файл');
    if (file.size > MAX_FILE) fail(413, 'Максимальный размер файла — 10 МБ');
    const { data } = await loadWorkspace(env), task = ensureShape(data).tasks.find(t => t.id === taskId);
    if (!task) fail(404, 'Задача не найдена');
    if (!canEdit(task, me)) fail(403, 'Можно прикладывать файлы только к своим задачам');
    const id = uid();
    await env.FILES.put(`tasks/${taskId}/${id}`, await file.arrayBuffer());
    await env.DB.prepare('INSERT INTO files (id, task_id, name, type, size, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, taskId, clip(file.name || 'файл', 200), clip(file.type || 'application/octet-stream', 100), file.size, me.email, now()).run();
    return json({ id });
  }

  if (path === '/api/task-actions' && req.method === 'POST') {
    const body = await readJson(req), team = await teamList(env), admins = await adminEmails(env), notes = [], log = [];
    const saved = await mutate(env, (server, current, next) => {
      notes.length = 0; log.length = 0;
      const d = ensureShape(server), find = id => d.tasks.find(t => t.id === id) || fail(404, 'Задача не найдена'), mark = t => Object.assign(t, { _rev: next, updatedAt: now(), updatedBy: me.email });
      switch (body.action) {
        case 'submit': {
          const t = find(body.id); if (!canEdit(t, me)) fail(403, 'Можно сдавать только свои задачи');
          const review = t.requiresReview !== false;
          t.result = { text: clip(body.text, 5000), url: /^https?:\/\//.test(body.url || '') ? clip(body.url, 2000) : '', fileIds: Array.isArray(body.fileIds) ? body.fileIds.slice(0, 10).map(x => clip(x, 100)) : [], submittedAt: now(), submittedBy: me.email, review: null };
          t.status = review ? 'approval' : 'done'; if (!review) t.progress = 100; mark(t);
          if (review) notify(notes, admins, `${me.name} сдал(а) результат: «${t.title}»`, t.id, me.email);
          log.push([t.id, review ? 'Сдан результат на проверку' : 'Сдан результат, задача завершена']);
          break;
        }
        case 'accept': case 'return': {
          requireAdmin(me);
          const t = find(body.id), accept = body.action === 'accept';
          t.result = { ...(t.result || {}), review: { decision: accept ? 'accept' : 'return', note: clip(body.note, 3000), at: now(), by: me.email } };
          t.status = accept ? 'done' : 'doing'; if (accept) t.progress = 100; mark(t);
          notify(notes, t.assigneeEmails || [], accept ? `Результат принят: «${t.title}»` : `Задача возвращена на доработку: «${t.title}»`, t.id, me.email);
          log.push([t.id, accept ? `Результат принят${body.note ? ': ' + body.note : ''}` : `Возвращено на доработку: ${body.note || ''}`]);
          break;
        }
        case 'assign': {
          requireAdmin(me);
          const p = body.patch || {};
          for (const id of Array.isArray(body.ids) ? body.ids : []) {
            const t = find(id), before = structuredClone(t);
            for (const k of ['title', 'description', 'expectedResult']) if (typeof p[k] === 'string') t[k] = clip(p[k], k === 'title' ? 300 : 5000);
            if ('lead' in p) { t.lead = clip(p.lead, 120); t.contributors = Array.isArray(p.contributors) ? p.contributors.map(x => clip(x, 120)).filter(x => x && x !== t.lead) : []; t.assignee = [t.lead, ...t.contributors].filter(Boolean).join(', '); }
            if ('dueDate' in p && isDate(p.dueDate)) t.dueDate = p.dueDate || '';
            if (['low', 'medium', 'high'].includes(p.priority)) t.priority = p.priority;
            if ('requiresReview' in p) t.requiresReview = !!p.requiresReview;
            applyPeople(t, team); mark(t); peopleChanges(before, t, notes, me.email);
          }
          break;
        }
        case 'archive': {
          requireAdmin(me);
          const t = find(body.id);
          d.tasks = d.tasks.filter(x => x.id !== t.id);
          const rels = d.relations.filter(r => r.sourceId === t.id || r.targetId === t.id);
          d.relations = d.relations.filter(r => !rels.includes(r));
          d.archive.unshift({ ...t, archivedAt: now(), archivedBy: me.email, archivedRelations: rels, _rev: next });
          log.push([t.id, 'Задача перенесена в архив']);
          break;
        }
        case 'restore': {
          requireAdmin(me);
          const a = d.archive.find(x => x.id === body.id) || fail(404, 'Задача не найдена в архиве');
          d.archive = d.archive.filter(x => x.id !== a.id);
          const { archivedAt, archivedBy, archivedRelations, ...t } = a;
          d.tasks.unshift({ ...t, _rev: next, _createdRev: next });
          const ids = new Set(d.tasks.map(x => x.id));
          d.relations.push(...(archivedRelations || []).filter(r => ids.has(r.sourceId) && ids.has(r.targetId)));
          log.push([t.id, 'Задача восстановлена из архива']);
          break;
        }
        default: fail(400, 'Неизвестное действие');
      }
      return d;
    });
    for (const [taskId, text] of log) await history(env, taskId, me.email, text);
    await flushNotes(env, notes);
    return json({ ok: true, revision: saved.revision });
  }
  fail(404, 'Не найдено');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    try {
      // Browsers send Origin on cross-site requests; together with SameSite cookies this blocks CSRF.
      const origin = req.headers.get('Origin');
      if (req.method !== 'GET' && origin && origin !== url.origin) fail(403, 'Запрос с другого сайта отклонён');
      const auth = await handleAuth(path, req, env);
      if (auth) return auth;
      const me = await currentUser(req, env);
      if (!me) fail(401, 'Войдите в аккаунт');
      return await handleApi(path, req, env, me);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Ошибка сервера. Попробуйте ещё раз.' }, 500);
    }
  }
};
