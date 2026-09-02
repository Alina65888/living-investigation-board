(() => {
  const KEY='living-hq-team-v1';
  const data=JSON.parse(localStorage.getItem(KEY)||'{"team":[],"projects":[]}');
  const save=()=>localStorage.setItem(KEY,JSON.stringify(data));
  const render=()=>{
    let panel=document.querySelector('.hq-upgrade-panel');
    if(!panel)return;
    panel.querySelector('.list').innerHTML='<b>Команда</b>'+data.team.map(x=>`<div class="hq-upgrade-card">👤 ${x}</div>`).join('')+'<br><b>Проекты</b>'+data.projects.map(x=>`<div class="hq-upgrade-card">📌 ${x}</div>`).join('');
  };
  const init=()=>{
    if(document.querySelector('.hq-upgrade-launcher'))return;
    const b=document.createElement('button');b.className='hq-upgrade-launcher';b.textContent='＋ Штаб';
    const p=document.createElement('div');p.className='hq-upgrade-panel';p.style.display='none';
    p.innerHTML=`<h3 style="margin:0">Штаб проекта</h3><div class="hq-upgrade-tabs"><button class="add-team">Добавить участника</button><button class="add-project">Добавить проект</button></div><div class="list"></div>`;
    document.body.append(b,p);
    b.onclick=()=>{p.style.display=p.style.display==='none'?'block':'none';render()};
    p.querySelector('.add-team').onclick=()=>{const n=prompt('Имя участника');if(n){data.team.push(n);save();render()}};
    p.querySelector('.add-project').onclick=()=>{const n=prompt('Название проекта');if(n){data.projects.push(n);save();render()}};
  };
  window.addEventListener('load',()=>setTimeout(init,700));
})();
