// Team mode sign-in: first administrator, email + password login, forced change of a temporary password,
// and the small account menu (change password, sign out).
import {api,auth,hosted} from './workspace-store.js?v=34';

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function screen(title,lead,fields,button,footer=''){
  const root=document.querySelector('#app');
  root.innerHTML=`<main class="auth-page"><form class="auth-card" novalidate><div class="auth-brand"><span class="auth-mark"></span><b>Living Project HQ</b></div><h1>${esc(title)}</h1><p class="auth-lead">${lead}</p>${fields.map(([name,label,type,extra=''])=>`<label class="auth-field"><span>${esc(label)}</span><input name="${name}" type="${type}" required ${extra}></label>`).join('')}<p class="auth-error" role="alert"></p><button class="auth-submit" type="submit">${esc(button)}</button>${footer}</form></main>`;
  const form=root.querySelector('form');form.querySelector('input')?.focus();
  return form;
}
function onSubmit(form,handler){
  form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('[type=submit]'),err=form.querySelector('.auth-error');err.textContent='';btn.disabled=true;
    try{await handler(new FormData(form))}catch(x){err.textContent=x.message;btn.disabled=false}};
}
const pwRule='не короче 8 символов';

function setupScreen(){
  const form=screen('Первый вход','Создайте учётную запись руководителя. Используйте email, который указан как адрес администратора в настройках сервера.',[['name','Имя и фамилия','text','autocomplete="name" maxlength="120"'],['email','Email','email','autocomplete="email"'],['password',`Пароль (${pwRule})`,'password','autocomplete="new-password" minlength="8"']],'Создать и войти');
  onSubmit(form,async f=>{await api('/api/setup',{name:f.get('name'),email:f.get('email'),password:f.get('password')});location.reload()});
}
function loginScreen(){
  const form=screen('Вход','Войдите под своим email и паролем. Если вы впервые — используйте временный пароль от руководителя.',[['email','Email','email','autocomplete="username"'],['password','Пароль','password','autocomplete="current-password"']],'Войти','<p class="auth-note">Забыли пароль? Попросите руководителя сбросить его в разделе «Команда».</p>');
  onSubmit(form,async f=>{await api('/api/login',{email:f.get('email'),password:f.get('password')});location.reload()});
}
function newPasswordScreen(me){
  const form=screen('Придумайте пароль',`${esc(me.name)}, вы вошли по временному паролю. Задайте свой — ${pwRule}.`,[['next','Новый пароль','password','autocomplete="new-password" minlength="8"'],['repeat','Повторите пароль','password','autocomplete="new-password" minlength="8"']],'Сохранить и продолжить');
  onSubmit(form,async f=>{if(f.get('next')!==f.get('repeat'))throw new Error('Пароли не совпадают');await api('/api/password',{next:f.get('next')});location.reload()});
}

// Resolves when the app may start; otherwise shows a sign-in screen and never resolves.
export function authGate(){
  if(!hosted)return Promise.resolve();
  if(auth.serverError){screen('Сайт настраивается',esc(auth.serverError),[],'Проверить снова');document.querySelector('.auth-card').onsubmit=e=>{e.preventDefault();location.reload()};return new Promise(()=>{})}
  if(auth.me&&!auth.me.mustChange)return Promise.resolve();
  if(auth.me)newPasswordScreen(auth.me);else if(auth.setup)setupScreen();else loginScreen();
  return new Promise(()=>{});
}

export function openAccount(modal,toast){
  const me=auth?.me;if(!me)return;
  const m=modal(`<h2>${esc(me.name)}</h2><p class="data-note">${esc(me.email)} · ${me.role==='admin'?'Администратор':'Участник'}</p><form class="account-form"><div class="field"><label>Текущий пароль</label><input type="password" name="current" autocomplete="current-password" required></div><div class="field"><label>Новый пароль (${pwRule})</label><input type="password" name="next" autocomplete="new-password" minlength="8" required></div><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn ghost" data-logout>Выйти из аккаунта</button><button type="button" class="btn" data-close>Закрыть</button><button class="btn primary" type="submit">Сменить пароль</button></div></form>`);
  m.querySelector('[data-close]').onclick=()=>m.remove();
  m.querySelector('[data-logout]').onclick=async()=>{await api('/api/logout',{});location.reload()};
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),err=m.querySelector('.form-error');try{await api('/api/password',{current:f.get('current'),next:f.get('next')});m.remove();toast('Пароль изменён')}catch(x){err.textContent=x.message}};
}
