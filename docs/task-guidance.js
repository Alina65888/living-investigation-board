// Guidance is derived from existing task data; it never changes workflow state.
export function nextStep(task,{manager=false,blockers=[]}={}){
  if(task.status==='done')return 'Задача выполнена.';
  if(task.status==='approval')return manager?'Ваш ход: проверьте результат и примите его или верните с замечаниями.':'Результат у руководителя. Повторно отправлять его не нужно.';
  if(task.result?.review?.decision==='return')return 'Исправьте замечания руководителя и отправьте результат повторно.';
  if(blockers.length)return 'Сначала нужно завершить: '+blockers.map(t=>t.title).join('; ')+'.';
  if(task.status==='blocked')return 'Работа остановлена. Уточните, какая помощь нужна для продолжения.';
  if(manager&&!task.assignee)return 'Назначьте ответственного за результат.';
  return task.requiresReview===true?'После выполнения сдайте результат: достаточно комментария, ссылки или файла.':'Выполните задачу и нажмите «Завершить». Отчёт и файлы не нужны.';
}
export function groupMyTasks(tasks,today,end){
  const active=tasks.filter(t=>t.status!=='done');
  const returned=t=>t.status!=='approval'&&t.result?.review?.decision==='return';
  const work=active.filter(t=>t.status!=='approval'&&!returned(t));
  return [
    ['Нужны исправления',active.filter(returned),'is-returned'],
    ['Просрочено',work.filter(t=>t.dueDate&&t.dueDate<today),'is-late'],
    ['Сегодня',work.filter(t=>t.dueDate===today),'today'],
    ['На неделе',work.filter(t=>t.dueDate>today&&t.dueDate<=end),''],
    ['Позже и без срока',work.filter(t=>!t.dueDate||t.dueDate>end),''],
    ['На проверке у руководителя',active.filter(t=>t.status==='approval'),'']
  ];
}
export function weekTasks(tasks,today,end){return tasks.filter(t=>t.status!=='done'&&t.dueDate>=today&&t.dueDate<=end).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.title.localeCompare(b.title,'ru'));}
