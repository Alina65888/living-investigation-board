// Keep project filters local to Projects; daily work only follows the explicit search.
export function dailyTasks(tasks,projects,query=''){
 const q=query.trim().toLocaleLowerCase('ru');
 if(!q)return [...tasks];
 const names=new Map(projects.map(p=>[p.id,p.name]));
 return tasks.filter(t=>[t.title,t.description,t.assignee,names.get(t.projectId)].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(q));
}
export function disclosureKey(el){return el.dataset.uiKey||[(el.closest('[data-task-card]')||{}).dataset?.taskCard||'',el.querySelector('summary')?.textContent].join(':')}
export function captureSurface(root){return {scroll:root?.querySelector('.main-scroll')?.scrollTop||0,open:new Set([...root?.querySelectorAll('details[open]')||[]].map(disclosureKey))};}
export function restoreSurface(root,saved){if(!saved)return;root?.querySelectorAll('details').forEach(el=>{if(saved.open.has(disclosureKey(el)))el.open=true});const area=root?.querySelector('.main-scroll');if(area)area.scrollTop=saved.scroll;}
