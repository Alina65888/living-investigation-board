(() => {
  const KEY='living-hq-team-v2';
  const data=JSON.parse(localStorage.getItem(KEY)||'{"team":[],"projects":[],"notes":[]}');
  const save=()=>localStorage.setItem(KEY,JSON.stringify(data));

  const render=()=>{
    const panel=document.querySelector('.hq-upgrade-panel');
    if(!panel)return;
    panel.querySelector('.list').innerHTML=`
      <section class="hq-section">
        <h4>Команда</h4>
        ${data.team.length?data.team.map((x,i)=>`<div class="hq-upgrade-card"><span class="avatar">${i+1}</span>${x}</div>`).join(''):'<small>Участники пока не добавлены</small>'}
      </section>
      <section class="hq-section">
        <h4>Проекты</h4>
        ${data.projects.length?data.projects.map(x=>`<div class="hq-upgrade-card">📌 ${x}</div>`).join(''):'<small>Проекты пока не добавлены</small>'}
      </section>
      <section class="hq-section">
        <h4>Быстрые заметки</h4>
        ${data.notes.map(x=>`<div class="hq-upgrade-card">💡 ${x}</div>`).join('')}
      </section>`;
  };

  const init=()=>{
    if(document.querySelector('.hq-upgrade-launcher'))return;
    const b=document.createElement('button');
    b.className='hq-upgrade-launcher';
    b.textContent='＋ Штаб';
    const p=document.createElement('aside');
    p.className='hq-upgrade-panel';
    p.style.display='none';
    p.innerHTML=`
      <div class="hq-head"><h3>Штаб проекта</h3><button class="close">×</button></div>
      <div class="hq-upgrade-tabs">
        <button class="add-team">+ Участник</button>
        <button class="add-project">+ Проект</button>
        <button class="add-note">+ Заметка</button>
      </div>
      <div class="list"></div>`;
    document.body.append(b,p);

    b.onclick=()=>{p.style.display=p.style.display==='none'?'block':'none';render()};
    p.querySelector('.close').onclick=()=>p.style.display='none';
    p.querySelector('.add-team').onclick=()=>{const n=prompt('Имя участника');if(n){data.team.push(n);save();render()}};
    p.querySelector('.add-project').onclick=()=>{const n=prompt('Название проекта');if(n){data.projects.push(n);save();render()}};
    p.querySelector('.add-note').onclick=()=>{const n=prompt('Заметка штаба');if(n){data.notes.push(n);save();render()}};
  };

  window.addEventListener('load',()=>setTimeout(init,500));
})();
