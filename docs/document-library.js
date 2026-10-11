// Project folders from the supplied archive screenshots. Codes stay editable.
export const DEFAULT_FOLDERS = [
  ['mant-vov','МАНТ','Великая Отечественная война','ВОВ'],
  ['mant-pearl','МАНТ','Жемчужина мира','ЖМ'],
  ['mant-friendship','МАНТ','Дружба народов — богатство Татарстана','ДН'],
  ['mant-student','МАНТ','День иностранного студента','ДИС'],
  ['mant-mt','МАНТ','Многоликий Татарстан','МТ'],
  ['mant-voices','МАНТ','Голоса Поволжья','ГП'],
  ['mant-meetings','МАНТ','Встречи с иностранными студентами','ВИС'],
  ['mant-russia','МАНТ','День России','ДР'],
  ['mant-heroes','МАНТ','Наши Герои','НГ'],
  ['mant-national','МАНТ','Национальное актуальным','НА'],
  ['ckd-dictation','ЦКД','Тотальный диктант','ТД'],
  ['ckd-olympiad','ЦКД','Олимпиада','ОЛ'],
  ['ckd-glagol','ЦКД','Глагол','ГЛ'],
  ['ckd-kmch','ЦКД','КМЧ','КМЧ'],
  ['ckd-sport','ЦКД','Спартакиада','СП'],
  ['ckd-park','ЦКД','Шатровый парк','ШП'],
  ['ckd-knt','ЦКД','КНТ','КНТ'],
  ['ckd-ies','ЦКД','ИЭС','ИЭС'],
  ['ckd-dpi','ЦКД','ДПИ','ДПИ'],
].map(([id,organization,name,code])=>({id,organization,name,code}));
export function projectCode(project={}) {
  if(String(project.code||'').trim())return String(project.code).trim();
  const normalize=s=>String(s||'').toLowerCase().replace(/[^а-яa-z0-9]/g,'');
  const known=DEFAULT_FOLDERS.find(f=>f.id===project.id||normalize(f.name)===normalize(project.name));
  if(known)return known.code;
  const words=String(project.name||'').match(/[А-Яа-яЁёA-Za-z0-9]+/g)||[];
  return words.length===1?words[0].slice(0,3).toUpperCase():words.filter(w=>!['и','в','на','по','для'].includes(w.toLowerCase())).map(w=>w[0]).join('').slice(0,10).toUpperCase();
}
export function fillProjectCodes(folders){for(const f of folders)if(!String(f.code||'').trim())f.code=projectCode(f);return folders;}
export const safeFilename=s=>String(s).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');
export function projectDocumentFilename(kind,project,year){return safeFilename(`${kind==='estimate'?'Смета':'Реестр'} ${year} (${projectCode(project)||'ПРОЕКТ'})`)+'.docx';}
export const dealYear=d=>/^\d{4}/.exec(d.date||'')?.[0]||'Без даты';
export function counterpartyName(p={}) {
  if(p.kind==='org')return p.shortName||p.name||'Контрагент не указан';
  const [last='',...names]=String(p.fio||'').trim().split(/\s+/);
  const name=[last,...names.map(n=>n[0]+'.')].filter(Boolean).join(' ');
  return (p.kind==='ip'?'ИП ':'')+(name||'Контрагент не указан');
}
const numberLabel=n=>!n||/^(б[\/\s-]?н|без номера)$/i.test(String(n).trim())?'БН':'№ '+String(n).trim().replace(/^№\s*/,'');
export function documentFilename(kind,d,p,project={}) {
  const type={contract:'Договор',invoice:'Счет',act:'Акт',upd:'УПД'}[kind];
  if(!type)throw new Error('Неизвестный документ');
  const date=kind==='invoice'?(d.invoiceDate||d.date):kind==='upd'?(d.updDate||d.actDate||d.deadline||d.date):kind==='act'?(d.actDate||d.deadline||d.date):d.date;
  const number=kind==='act'?'':kind==='invoice'?(d.invoiceNumber||d.number):kind==='upd'?(d.updNumber||d.number):d.number;
  const code=String(d.projectCode||projectCode(project)||'').trim();
  const label=[date?date.replace(/-/g,'.'):'Без даты',type,numberLabel(number),counterpartyName(p),code?'('+code+')':''].filter(Boolean).join(' ');
  return label.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'')+(kind==='upd'?'.xlsx':'.docx');
}
