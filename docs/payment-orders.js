import {sumItems,numberWords,plural,shortDate,partyTitle,partyShortTitle,checkParty,vatPayer} from './docgen.js?v=61';
import {fillPaymentXls} from './payment-xls.js?v=61';
const text=v=>String(v??'').trim(),digits=v=>text(v).replace(/\s/g,''),blank=v=>v===undefined||v===null||v==='';
export const paymentVariant=p=>p?.kind==='npd'?'npd':['org','ip'].includes(p?.kind)?'business':null;
export const paymentBasis=(d,e)=>d.paymentBasis||(e?.kind==='npd'?'contract':'invoice');
export function paymentAmount(d){return blank(d.paymentAmount)?sumItems(d.items||[]):Number(String(d.paymentAmount).replace(',','.'));}
const cents=n=>Math.round(n*100);
export function paymentMoney(n){const v=cents(n);return Math.floor(v/100)+'-'+String(v%100).padStart(2,'0');}
export function paymentWords(n){const v=cents(n),rub=Math.floor(v/100),kop=v%100,w=numberWords(rub);return `${w[0].toUpperCase()+w.slice(1)} ${plural(rub,'рубль','рубля','рублей')} ${String(kop).padStart(2,'0')} ${plural(kop,'копейка','копейки','копеек')}`;}
export function paymentDescription(d,e,project={}){
 const basis=paymentBasis(d,e),contract=`договору № ${text(d.number)} от ${shortDate(d.date)}`;
 const ref=basis==='invoice'?`сч. ${text(d.invoiceNumber||d.number)} от ${shortDate(d.invoiceDate||d.date)}`:basis==='act'?`${contract} и акту от ${shortDate(d.actDate||d.deadline||d.date)}`:contract;
 const projectName=text(project.name),subject=text(d.subject),suffix=projectName&&!subject.toLocaleLowerCase('ru').includes(projectName.toLocaleLowerCase('ru'))?' в проекте '+projectName:'';
 return `Оплата по ${ref} за ${subject}${suffix}`;
}
export function paymentPurpose(d,e,project={}){
 const amount=paymentAmount(d),rate=Number(e?.vatRate),vat=vatPayer(e)?`В том числе НДС ${rate}% — ${paymentMoney(Math.round(amount*rate/(100+rate)*100)/100)}`:'Без налога (НДС)';
 return `${text(d.paymentPurpose)||paymentDescription(d,e,project)}\nСумма ${Number.isFinite(amount)?paymentMoney(amount):'—'}\n${vat}`;
}
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function paymentIssues(d,c,e,project={},deals=[]){
 const out=[];
 if(!paymentVariant(e))out.push('ПП доступно для организаций, ИП и самозанятых.');
 for(const [p,label] of [[c,'Плательщик'],[e,'Получатель']]){
  if(!p){out.push(`${label}: выберите карточку стороны.`);continue;}
  if(!text(partyTitle(p)))out.push(`${label}: заполните название или ФИО.`);
  for(const [key,length,name] of [['inn',p.kind==='org'?10:12,'ИНН'],['account',20,'счет'],['bik',9,'БИК'],['corr',20,'корреспондентский счет']])if(!new RegExp(`^\\d{${length}}$`).test(digits(p[key])))out.push(`${label}: ${name} — ${length} цифр.`);
  if(p.kind==='org'&&!/^\d{9}$/.test(digits(p.kpp)))out.push(`${label}: КПП — 9 цифр.`);
  if(!text(p.bank))out.push(`${label}: укажите банк.`);
  out.push(...checkParty(p).filter(x=>/контрольной суммы|не сходится|не сходятся/.test(x)).map(x=>label+': '+x));
 }
 if(c&&e&&digits(c.inn)===digits(e.inn))out.push('ИНН плательщика и получателя совпадают.');
 if(!/^[0-9]{1,6}$/.test(text(d.paymentNumber))||Number(d.paymentNumber)===0)out.push('Укажите отдельный номер ПП: от 1 до 999999.');
 if(!validDate(d.paymentDate))out.push('Укажите дату платежного поручения.');
 const amount=paymentAmount(d);if(!Number.isFinite(amount)||amount<=0||amount>=1e12||Math.abs(amount*100-cents(amount))>0.0001)out.push('Сумма платежа должна быть больше нуля и содержать не более двух знаков после запятой.');
 if(!text(d.number)||!validDate(d.date))out.push('Заполните номер и дату договора.');
 const basis=paymentBasis(d,e);if(!['contract','invoice','act'].includes(basis)||e?.kind==='npd'&&basis==='invoice')out.push('Для самозанятого выберите договор или акт.');
 if(basis==='invoice'&&!validDate(d.invoiceDate||d.date))out.push('Проверьте дату счета.');
 if(basis==='act'&&!validDate(d.actDate||d.deadline||d.date))out.push('Проверьте дату акта.');
 if(!text(d.subject)&&!text(d.paymentPurpose))out.push('Заполните назначение платежа.');
 if(vatPayer(e)&&(!Number.isFinite(Number(e.vatRate))||Number(e.vatRate)<=0||Number(e.vatRate)>100))out.push('Укажите ставку НДС в карточке контрагента.');
 if(paymentPurpose(d,e,project).length>210)out.push('Сократите назначение платежа до 210 символов вместе со строками суммы и НДС.');
 if(text(d.paymentIncomeCode)&&!['1','2','3','4','5'].includes(text(d.paymentIncomeCode)))out.push('Проверьте код вида дохода.');
 if(text(d.paymentUin)&&!/^\d{1,25}$/.test(text(d.paymentUin)))out.push('Код УИН должен содержать до 25 цифр.');
 if(deals.some(x=>x.id!==d.id&&x.customerId===d.customerId&&Number(x.paymentNumber)===Number(d.paymentNumber)&&x.paymentDate?.slice(0,4)===d.paymentDate?.slice(0,4)))out.push('Этот номер ПП уже указан в другой сделке плательщика за тот же год.');
 for(const p of [c,e].filter(Boolean))for(const [key,max] of [['bank',120],['name',160],['fio',100]])if(text(p[key]).length>max)out.push('Сократите '+(key==='bank'?'название банка':'название стороны')+' для бланка ПП.');
 return [...new Set(out)];
}
export function paymentValues(d,c,e,project={}){
 const issues=paymentIssues(d,c,e,project);if(issues.length)throw Error(issues.join('\n'));
 return {A4:'ПЛАТЕЖНОЕ ПОРУЧЕНИЕ № '+text(d.paymentNumber),I4:shortDate(d.paymentDate),B6:paymentWords(paymentAmount(d)),A7:'ИНН '+digits(c.inn),F7:'КПП '+(c.kind==='org'?digits(c.kpp):''),M7:paymentMoney(paymentAmount(d)),A9:c.kind==='org'?partyShortTitle(c):partyTitle(c),M10:digits(c.account),M12:digits(c.bik),A13:text(c.bank),M14:digits(c.corr),M16:digits(e.bik),A17:text(e.bank),M18:digits(e.corr),A20:'ИНН '+digits(e.inn),F20:'КПП '+(e.kind==='org'?digits(e.kpp):e.kind==='npd'?'0':''),M20:digits(e.account),A22:e.kind==='org'?partyShortTitle(e):partyTitle(e),A29:paymentPurpose(d,e,project),M24:text(d.paymentIncomeCode),M25:text(d.paymentUin)};
}
export async function paymentOrderXls(d,c,e,project={},template){
 const values=paymentValues(d,c,e,project);
 if(!template){const url=new URL('./templates/payment-'+paymentVariant(e)+'.json',import.meta.url);url.search=new URL(import.meta.url).search;const r=await fetch(url);if(!r.ok)throw Error('Не удалось загрузить шаблон ПП. Обновите страницу.');template=await r.json();}
 if(template.variant!==paymentVariant(e))throw Error('Шаблон ПП не соответствует статусу получателя.');
 return fillPaymentXls(template,values);
}
