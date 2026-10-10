// Project folders from the supplied archive screenshots. Codes stay editable.
export const DEFAULT_FOLDERS = [
  ['mant-vov','МАНТ','Великая Отечественная война','ВОВ'],
  ['mant-pearl','МАНТ','Жемчужина мира',''],
  ['mant-friendship','МАНТ','Дружба народов — богатство Татарстана',''],
  ['mant-student','МАНТ','День иностранного студента',''],
  ['mant-mt','МАНТ','Многоликий Татарстан','МТ'],
  ['mant-voices','МАНТ','Голоса Поволжья',''],
  ['mant-meetings','МАНТ','Встречи с иностранными студентами',''],
  ['mant-russia','МАНТ','День России',''],
  ['mant-heroes','МАНТ','Наши Герои',''],
  ['mant-national','МАНТ','Национальное актуальным',''],
  ['ckd-dictation','ЦКД','Тотальный диктант','ТД'],
  ['ckd-olympiad','ЦКД','Олимпиада',''],
  ['ckd-glagol','ЦКД','Глагол',''],
  ['ckd-kmch','ЦКД','КМЧ','КМЧ'],
  ['ckd-sport','ЦКД','Спартакиада','СП'],
  ['ckd-park','ЦКД','Шатровый парк',''],
  ['ckd-knt','ЦКД','КНТ','КНТ'],
  ['ckd-ies','ЦКД','ИЭС','ИЭС'],
  ['ckd-dpi','ЦКД','ДПИ','ДПИ'],
].map(([id,organization,name,code])=>({id,organization,name,code}));
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
  const code=String(d.projectCode||project.code||project.name||'').trim();
  const label=[date?date.replace(/-/g,'.'):'Без даты',type,numberLabel(number),counterpartyName(p),code?'('+code+')':''].filter(Boolean).join(' ');
  return label.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'')+(kind==='upd'?'.xlsx':'.docx');
}
