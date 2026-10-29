export const customer={id:'c',kind:'org',name:'Общество с ограниченной ответственностью «Плательщик»',shortName:'ООО «Плательщик»',inn:'7707083893',kpp:'773601001',account:'40702810938000000001',bik:'044525225',corr:'30101810400000000225',bank:'ПАО Сбербанк'};
export const npd={id:'e',kind:'npd',fio:'Иванова Анна Петровна',inn:'770708300042',account:'40817810738000000002',bik:'044525225',corr:'30101810400000000225',bank:'ПАО Сбербанк'};
// Synthetic person INN with a valid checksum, never an example recipient's data.
const d=npd.inn.slice(0,10).split('').map(Number),k=w=>w.reduce((s,x,i)=>s+x*d[i],0)%11%10;d[10]=k([7,2,4,10,3,5,9,4,6,8]);d[11]=k([3,7,2,4,10,3,5,9,4,6,8]);npd.inn=d.join('');
export const company={...customer,id:'e',name:'ООО «Получатель»',shortName:'ООО «Получатель»',inn:'1653001805',kpp:'165301001',vat:true,vatRate:22};
export const deal={id:'d',type:'services',city:'Казань',customerId:'c',executorId:'e',number:'1/К',date:'2026-09-10',actDate:'2026-10-19',invoiceNumber:'09-26/К1',invoiceDate:'2026-09-10',subject:'питание',paymentNumber:'28',paymentDate:'2026-10-29',items:[{name:'питание',qty:1,price:14533.12}]};
export const project={name:'Кухни народов Татарстана',code:'КНТ'};
