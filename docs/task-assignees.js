// Display-only filters. Permission checks continue to use the server account role.
const norm=value=>String(value||'').trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
const email=value=>String(value||'').trim().toLowerCase();
const list=value=>Array.isArray(value)?value:[];
export function taskAssigneeKeys(task,team=[]){
 const emails=[...new Set([task.assigneeEmail,...list(task.assigneeEmails)].map(email).filter(Boolean))];
 const names=[...new Set([task.lead,...list(task.contributors),...list(task.assignees),...String(task.assignee||'').split(/[;,]/)].map(norm).filter(Boolean))];
 const keys=emails.map(e=>'email:'+e);
 for(const name of names){
  let matches=team.filter(m=>norm(m.name)===name);
  if(!matches.length&&!name.includes(' '))matches=team.filter(m=>(m.active||m.pending)&&norm(m.name).split(' ')[0]===name);
  // Saved account identifiers disambiguate namesakes; legacy text is used
  // only when no linked account exists for that name.
  if(matches.length>1&&matches.some(m=>emails.includes(email(m.email))))continue;
  if(matches.length===1)keys.push('email:'+email(matches[0].email));
  else keys.push('name:'+name);
 }
 return [...new Set(keys)];
}
export function matchesAssignee(task,key='all',team=[]){
 if(key==='all')return true;
 const keys=taskAssigneeKeys(task,team);
 return key==='unassigned'?!keys.length:keys.includes(key);
}
export function assigneeOptions(tasks,team=[]){
 const keys=new Set(tasks.flatMap(t=>taskAssigneeKeys(t,team)));
 for(const m of team)if(m.active||m.pending)keys.add('email:'+email(m.email));
 const names=new Map();
 for(const t of tasks)for(const name of [t.lead,...list(t.contributors),...list(t.assignees),...String(t.assignee||'').split(/[;,]/)])if(norm(name))names.set(norm(name),String(name).trim());
 const options=[...keys].map(key=>{
  if(key.startsWith('name:'))return {key,label:names.get(key.slice(5))||key.slice(5)};
  const address=key.slice(6),member=team.find(m=>email(m.email)===address);
  if(!member)return {key,label:address};
  const duplicate=team.filter(m=>norm(m.name)===norm(member.name)).length>1;
  return {key,label:member.name+(duplicate?' · '+address:'')+(!member.active&&!member.pending?' (неактивен)':'')};
 }).sort((a,b)=>a.label.localeCompare(b.label,'ru'));
 return [{key:'all',label:'Все исполнители'},{key:'unassigned',label:'Без исполнителя'},...options];
}
