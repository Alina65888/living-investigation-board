(()=>{
const KEY='living-hq-team-v1';
function get(){try{return JSON.parse(localStorage.getItem(KEY)||'{"team":[],"projects":[]}')}catch{return {team:[],projects:[]}}}
function save(d){localStorage.setItem(KEY,JSON.stringify(d))}
function renderStats(){
 const root=document.querySelector('.hq-upgrade-panel');
 if(!root||root.querySelector('.v10'))return;
 const box=document.createElement('div');box.className='v10';
 box.innerHTML=`<hr><h4>Панель проекта</h4><div class="v10-grid"><span>📌 Задачи</span><span>👥 Команда</span><span>⚠️ Риски</span><span>🔗 Связи</span></div><button class="v10-add-task">＋ Добавить задачу на доску</button>`;
 root.appendChild(box);
 box.querySelector('.v10-add-task').onclick=()=>{
  const title=prompt('Название задачи');
  if(!title)return;
  const d=get();d.tasks??=[];d.tasks.push({title,status:'planned',created:new Date().toISOString()});save(d);alert('Задача добавлена в штаб. Следующий этап — связать ее с визуальной доской.');
 }
}
new MutationObserver(renderStats).observe(document.body,{childList:true,subtree:true});
})();
