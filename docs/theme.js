// Look & feel: accent colour (remembered on this device), greeting, entrance animations and count-up numbers.
// Pure presentation — no data is read or written here except the accent choice in localStorage.
export const ACCENTS = [
  ['honey', 'Янтарь', '#f2b632'],
  ['forest', 'Лес', '#1f6b47'],
  ['ocean', 'Океан', '#2459c6'],
  ['plum', 'Слива', '#6f42b0'],
  ['ember', 'Терракота', '#c2552b'],
  ['graphite', 'Графит', '#1d1d1f']
];
const KEY = 'lphq-accent';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = v => { try { localStorage.setItem(KEY, v); } catch { /* private mode: the choice lasts until reload */ } };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function applyAccent(id = read()) {
  const known = ACCENTS.find(a => a[0] === id) ? id : 'honey';
  document.documentElement.dataset.accent = known;
  return known;
}
applyAccent();

export function greeting(name) {
  const h = new Date().getHours(), first = String(name || '').trim().split(/\s+/)[0];
  const word = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  return first ? `${word}, ${first}` : word;
}

// Half-donut gauge: share of finished tasks, with "in progress" and hatched "remaining".
export function gauge(done, doing, total, label = 'выполнено') {
  const pct = total ? Math.round(done / total * 100) : 0, r = 70, len = Math.PI * r;
  const a = total ? done / total : 0, b = total ? doing / total : 0;
  const arc = (from, part, cls) => part > 0 ? `<path class="${cls}" d="M10 80 A70 70 0 0 1 150 80" pathLength="${len}" stroke-dasharray="${part * len} ${len}" stroke-dashoffset="${-from * len}"/>` : '';
  return `<div class="gauge" role="img" aria-label="${pct}% ${label}"><svg viewBox="0 0 160 90" aria-hidden="true"><defs><pattern id="gauge-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="gauge-hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="gauge-hatch-line"/></pattern></defs><path class="g-rest" d="M10 80 A70 70 0 0 1 150 80"/>${arc(0, a, 'g-done')}${arc(a, b, 'g-doing')}</svg><div class="gauge-num"><strong data-count="${pct}">${pct}</strong><span>%</span><small>${label}</small></div></div>`;
}

export function toastPill(text) {
  document.querySelector('.theme-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'theme-toast'; t.setAttribute('role', 'status'); t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

function picker() {
  const wrap = document.createElement('div');
  wrap.className = 'accent-picker';
  wrap.innerHTML = `<button class="btn icon-round" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Цвет оформления" title="Цвет оформления"><span class="accent-dot"></span></button><div class="accent-pop" role="menu" hidden><b>Цвет оформления</b><p>Меняет акцент на всём сайте. Запоминается на этом устройстве.</p><div class="accent-grid">${ACCENTS.map(([id, name, c]) => `<button type="button" role="menuitemradio" data-accent-pick="${id}"><i style="background:${c}"></i>${name}</button>`).join('')}</div></div>`;
  const btn = wrap.querySelector('button'), pop = wrap.querySelector('.accent-pop');
  const sync = () => wrap.querySelectorAll('[data-accent-pick]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.accentPick === document.documentElement.dataset.accent)));
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); sync(); };
  wrap.querySelectorAll('[data-accent-pick]').forEach(b => b.onclick = () => {
    const id = applyAccent(b.dataset.accentPick); write(id); sync(); close();
    toastPill(`Цвет: ${ACCENTS.find(a => a[0] === id)[1]}`);
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return wrap;
}

// Accent swatches for the phone menu (the header button is hidden on narrow screens).
export function accentMenu() {
  const cur = document.documentElement.dataset.accent;
  return `<div class="accent-menu"><b>Цвет оформления</b><div class="accent-grid">${ACCENTS.map(([id, name, c]) => `<button type="button" data-accent-pick="${id}" aria-checked="${id === cur}"><i style="background:${c}"></i>${name}</button>`).join('')}</div></div>`;
}
export function bindAccentMenu(root) {
  root.querySelectorAll('.accent-menu [data-accent-pick]').forEach(b => b.onclick = () => {
    const id = applyAccent(b.dataset.accentPick); write(id);
    root.querySelectorAll('.accent-menu [data-accent-pick]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.accentPick === id)));
    toastPill(`Цвет: ${ACCENTS.find(a => a[0] === id)[1]}`);
  });
}

// Numbers count up and cards rise in only when a page is opened, not on every small re-render.
function countUp(root) {
  if (reduced()) return;
  root.querySelectorAll('.kpi strong, [data-count]').forEach(el => {
    const target = Number(el.dataset.count ?? el.textContent);
    if (!Number.isFinite(target) || target <= 0 || target > 100000) return;
    const t0 = performance.now(), dur = 650;
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = String(Math.round(target * e)); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  });
}
function watch() {
  const app = document.querySelector('#app');
  if (!app) return;
  let lastKey = '';
  const ensurePicker = () => {
    const actions = document.querySelector('.top-actions');
    if (actions && !actions.querySelector('.accent-picker')) actions.insertBefore(picker(), actions.querySelector('#newTask') || null);
  };
  const onMain = () => {
    const main = document.querySelector('#main');
    if (!main) return;
    const key = (document.querySelector('.view-tabs .active')?.textContent || '') + '|' + (main.querySelector('.page-head h1')?.textContent || '').replace(/\d+/g, '');
    if (key === lastKey) return;
    lastKey = key;
    main.classList.remove('is-entering'); void main.offsetWidth; main.classList.add('is-entering');
    countUp(main);
    setTimeout(() => main.classList.remove('is-entering'), 900);
  };
  new MutationObserver(() => { ensurePicker(); onMain(); }).observe(app, { childList: true, subtree: true });
  ensurePicker(); onMain();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
