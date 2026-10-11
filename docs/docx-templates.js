// Fill the approved Word packages without rebuilding their styles, sections or tables.
import * as G from './docgen.js?v=41';

const encode = new TextEncoder(), decode = new TextDecoder();
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const digits = s => String(s ?? '').replace(/\D/g, '');
const cache = new Map();

export function templateName(kind, deal, executor) {
  if (kind === 'invoice') return executor.kind === 'ip' ? 'invoice-ip' : 'invoice-org';
  if (kind === 'act') return 'act';
  return 'services';
}

async function loadTemplate(name) {
  if (!cache.has(name)) {
    const url = new URL(`./templates/${name}.docx`, import.meta.url);
    url.search = new URL(import.meta.url).search;
    const request = fetch(url).then(async r => {
      if (!r.ok) throw new Error('Не удалось загрузить шаблон документа. Обновите страницу и попробуйте ещё раз.');
      const buffer = await r.arrayBuffer();
      // Detect HTML fallbacks before putting them into the cache.
      if (!G.unzipStored(buffer)['word/document.xml']) throw new Error('Повреждён шаблон документа');
      return buffer;
    }).catch(error => { cache.delete(name); throw error; });
    cache.set(name, request);
  }
  return cache.get(name);
}

function partyData(p, side, role, tail) {
  const title = G.partyTitle(p), personal = p.kind === 'npd' || p.kind === 'person';
  const preamble = G.partyPreamble(p, role);
  const lead = personal ? preamble.slice(0, preamble.indexOf(',')) : title;
  const fields = {
    Title: title, ShortTitle: p.shortName || title, Role: role, RoleColon: role + ':',
    HeadTitle: p.kind === 'ip' ? 'Индивидуальный предприниматель' : title,
    HeadName: p.kind === 'ip' ? p.fio : '',
    PreambleName: lead, PreambleTail: preamble.slice(lead.length) + ', ' + tail,
    RegistrationLabel: personal ? 'Паспорт' : p.kind === 'ip' ? 'ОГРНИП' : 'ОГРН',
    Registration: personal ? p.passport : p.ogrn,
    TaxLabel: p.kind === 'org' ? 'ИНН / КПП' : 'ИНН',
    Tax: p.kind === 'org' ? `${digits(p.inn)} / ${digits(p.kpp)}` : digits(p.inn),
    Inn: digits(p.inn), Kpp: p.kind === 'org' ? digits(p.kpp) : '',
    AddressLabel: 'Адрес', Address: p.address, AccountLabel: 'Р/с', Account: p.account,
    BankLabel: 'Банк', Bank: p.bank, CorrLabel: 'К/с', Corr: p.corr,
    BikLabel: 'БИК', Bik: p.bik, EmailLabel: 'E-mail', Email: p.email,
    Position: p.kind === 'org' ? cap(p.signerPosition || 'Директор') : p.kind === 'ip' ? 'Индивидуальный предприниматель' : p.fio,
    Signature: G.initials(p.kind === 'org' ? p.signer : p.fio), Stamp: personal ? '' : 'М. П.',
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [side + key, value ?? '']));
}

function dataFor(deal, customer, executor) {
  const t = G.DEAL_TYPES[deal.type], total = G.sumItems(deal.items), days = deal.payDays || 15;
  const period = deal.period ? ' ' + deal.period : '', reference = `Договору ${t.title} № ${deal.number} от ${G.longDate(deal.date).replace(/ г\.$/, ' года')}`;
  const customerBy = deal.type === 'supply' ? 'Покупателем' : 'Заказчиком';
  const executorBy = deal.type === 'supply' ? 'Поставщиком' : deal.type === 'works' ? 'Подрядчиком' : 'Исполнителем';
  const payment = `${t.cust} оплачивает Стоимость по Договору ${t.execDat} путем перечисления денежных средств на расчетный счет ${t.execGen} в размере 100% оплаты в течение ${days} (${cap(G.numberWords(days))}) рабочих дней с момента подписания Акта об исполнении обязательств${executor.kind === 'org' || executor.kind === 'ip' ? ' и/или УПД' : ''}.`;
  const subject = deal.type === 'supply'
    ? `1.1. Поставщик обязуется поставить в течение срока действия Договора Товары по заданию Покупателя согласно Спецификации (Приложение № 1 к настоящему договору): ${deal.subject}${period}, а Покупатель в случае отсутствия мотивированных возражений обязуется принять и оплатить Товар.`
    : `1.1. ${t.exec} обязуется по заданию Заказчика ${t.verb} ${t.objAcc} согласно Спецификации (Приложение № 1 к настоящему договору): ${deal.subject}${period}, а Заказчик в случае отсутствия мотивированных возражений обязуется принять и оплатить ${t.objAcc}.`;
  return {
    ...partyData(customer, 'customer', t.cust, 'с другой стороны,'),
    ...partyData(executor, 'executor', t.exec, 'с одной стороны, и'),
    executorGen: t.execGen, executorDat: t.execDat, executorInstrumental: executorBy,
    customerGen: t.custGen, customerDat: t.custDat, customerInstrumental: customerBy,
    verbObject: `${t.verb} ${t.objAcc}`, objectQuality: deal.type === 'works' ? 'Работ, выполняемых' : 'Услуг, оказываемых',
    contractTitle: `${t.title} № ${deal.number}`,
    city: /^(г\.|с\.|пос\.|п\.|д\.)\s/.test(deal.city || '') ? deal.city : `г. ${deal.city || 'Казань'}`,
    date: G.longDate(deal.date), subjectClause: subject, paymentClause: '3.2. ' + payment,
    priceLead: `3.1. Стоимость ${t.objGen.toLowerCase()} по настоящему договору составляет: `,
    amountWithWords: G.amountWithWords(total), vatLine: G.vatLine(total, executor),
    appendixContract: `к Договору ${t.title}`, appendixReference: `№ ${deal.number} от ${G.longDate(deal.date)}`,
    itemGroup: deal.itemGroup || t.obj,
    totalLabel: G.vatPayer(executor) ? 'ИТОГО с НДС:' : executor.kind === 'npd' ? 'ИТОГО:' : 'ИТОГО без НДС:', total: G.money(total),
    appendixPayment: `Порядок расчетов: оплата производится ${customerBy} путем перечисления денежных средств на расчетный счет ${t.execGen} в размере 100% оплаты в соответствии с п. 3.2 Договора.`,
    appendixTotal: `Общая стоимость настоящего Приложения составляет: ${G.amountWithWords(total)} ${G.vatLine(total, executor)}`,
    deadline: deal.deadline ? `${t.term}: ${G.longDate(deal.deadline)}` : '',
    invoiceTitle: `Счет на оплату № ${deal.invoiceNumber || deal.number} от ${G.longDate(deal.invoiceDate || deal.date)}`,
    invoiceExecutor: `${G.partyTitle(executor)}, ИНН: ${digits(executor.inn)}`,
    invoiceCustomer: `${G.partyTitle(customer)}, ИНН: ${digits(customer.inn)}`,
    invoiceBasis: `Договор ${t.title} № ${deal.number} от ${G.shortDate(deal.date)}`,
    invoiceVatLabel: G.vatPayer(executor) ? `В том числе НДС ${G.vatRate(executor)}%:` : 'НДС:',
    invoiceVat: G.vatPayer(executor) ? G.money(G.vatAmount(total, executor)) : '–',
    invoiceCount: `Всего наименований ${deal.items.length} на сумму: ${G.money(total).split(',')[0]} руб. – ${G.money(total).split(',')[1]} коп.`,
    amountWords: G.amountWords(total),
    actTitle: 'Акт', actReference: `об исполнении обязательств по ${reference}`,
    actDate: G.longDate(deal.actDate || deal.deadline || deal.date),
    actIntro: 'совместно именуемые «Стороны», составили настоящий акт, в дальнейшем «Акт», о нижеследующем:',
    actDelivery: `1. Обязательства ${t.execGen} по ${reference}${period} выполнены в полном объеме в соответствии с Приложением № 1 – Спецификация № 1.`,
    actPayment: `2. Стоимость ${t.objGen.toLowerCase()} составляет: ${G.amountWithWords(total)} ${G.vatLine(total, executor)} ${deal.paid ? `Оплачена ${customerBy} в полном объеме.` : 'Оплата производится в соответствии с п. 3.2 Договора.'}`,
    actClaims: '3. Акт подтверждает отсутствие претензий к объему и качеству исполнения и составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из Сторон.',
  };
}

function fill(xmlText, values) {
  return xmlText.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error('Не заполнено поле шаблона: ' + key);
    // Line breaks stay inside the existing run, inheriting its exact font and size.
    return String(values[key] ?? '').split(/\r?\n/).map(xml).join('</w:t><w:br/><w:t xml:space="preserve">');
  });
}

function fillItems(document, items, approved=false) {
  const money=n=>approved?G.money(n).replace(/\u00a0/g,' '):G.money(n);
  const re = /<!--items:\d+:start-->([\s\S]*?)<!--items:\d+:end-->/g;
  const matches = [...document.matchAll(re)];
  if (!matches.length) return document;
  const rows = items.map((it, i) => fill(matches[Math.min(i, matches.length-1)][1], {
    itemNumber: `1.${i+1}`, invoiceItemNumber: String(i+1), itemName: it.name,
    itemDescription: it.description || '', itemFullName: [it.name,it.description].filter(Boolean).join('\n'),
    itemUnit: it.unit || '', itemQuantity: G.qty(it.qty), itemPrice: money(it.price), itemTotal: money(it.qty * it.price),
  })).join('');
  let first = true;
  return document.replace(re, () => { const result = first ? rows : ''; first = false; return result; });
}

// The approved wording is specifically for services provided by an NPD taxpayer.
// Never silently fall back to retired contracts or mislabel another tax status.
export function contractAvailability(deal, customer, executor) {
  if(!customer||!executor)return {message:'Выберите заказчика и исполнителя.',step:1,field:!customer?'customerId':'executorId',action:'Выбрать стороны'};
  if(executor.kind!=='npd')return {message:`Исполнитель указан как «${G.PARTY_KINDS[executor.kind]||executor.kind}». Новый шаблон договора предназначен для самозанятого. Для ИП, организации или физлица без НПД нужен соответствующий шаблон. Проверьте статус в карточке; меняйте его только если он указан неверно.`,step:1,party:'executorId',action:'Проверить статус исполнителя'};
  if(customer.kind!=='org')return {message:'Новый шаблон договора предназначен для заказчика-организации. Проверьте карточку заказчика.',step:1,party:'customerId',action:'Проверить заказчика'};
  if(deal.type!=='services')return {message:`Выбран тип сделки «${G.DEAL_TYPES[deal.type]?.short||deal.type}». Новый шаблон договора предназначен для услуг. Для поставки или подряда нужен соответствующий шаблон.`,step:2,field:'type',action:'Проверить тип сделки'};
  if(!String(deal.period||'').trim())return {message:'Укажите период оказания услуг, например: с 20 сентября по 31 октября 2026 г.',step:2,field:'period',action:'Указать период услуг'};
  return null;
}
export function contractIssue(deal, customer, executor) {
  return contractAvailability(deal,customer,executor)?.message||'';
}
function approvedContractData(deal, customer, executor) {
  const values=dataFor(deal,customer,executor);
  const servicePeriod=String(deal.period||'').trim().replace(/^в период\s+/i,'').replace(/ года\.?$/,' г.');
  return {...values,
    amountWithWords:G.amountWithWords(G.sumItems(deal.items)).replace(/\u00a0/g,' '),total:G.money(G.sumItems(deal.items)).replace(/\u00a0/g,' '),
    executorName:executor.fio,npdDate:G.shortDate(executor.npdDate),npdNumber:executor.npdNumber,
    customerTitle:customer.name,customerShortTitle:customer.shortName||customer.name,
    customerSignerGen:`${customer.signerPositionGen||G.positionGenitive(customer.signerPosition)} ${customer.signerGen||G.fioGenitive(customer.signer,customer.signerGender||G.personGender(customer.signer))}`,
    customerBasis:customer.basis||'устава',customerTax:`${digits(customer.inn)}/ ${digits(customer.kpp)}`,
    serviceSubject:`${String(deal.subject||'').trim()} в период ${servicePeriod.replace(/ г\.$/,' года')}`,
    servicePeriod,appendixReference:`№ ${deal.number} ${G.longDate(deal.date).replace(/ г\.$/,' года')}`,
  };
}

async function generate(kind, deal, customer, executor, buffer) {
  if(kind==='contract'){const issue=contractIssue(deal,customer,executor);if(issue)throw new Error(issue);}
  const files = G.unzipStored(buffer || await loadTemplate(templateName(kind, deal, executor)));
  if (!files['word/document.xml']) throw new Error('В шаблоне отсутствует документ Word');
  const values = kind==='contract'?approvedContractData(deal,customer,executor):dataFor(deal, customer, executor);
  for (const name of Object.keys(files)) {
    if (!/^word\/(document|header\d+|footer\d+)\.xml$/.test(name)) continue;
    // Fill scalar fields first so user-entered {{braces}} are never evaluated as placeholders.
    let text = decode.decode(files[name]);
    if(!text.includes('{{')&&!text.includes('<!--items:'))continue;
    const itemRows = [];
    text = text.replace(/<!--items:\d+:start-->[\s\S]*?<!--items:\d+:end-->/g, row => {
      itemRows.push(row); return `<!--item-slot:${itemRows.length-1}-->`;
    });
    text = fill(text, values);
    text = text.replace(/<!--item-slot:(\d+)-->/g, (_, i) => itemRows[+i]);
    text = fillItems(text, deal.items,kind==='contract');
    // Repeated rows need fresh paragraph identities; this metadata has no visual effect.
    let paragraphId = 0;
    text = text.replace(/w14:paraId="[A-Fa-f0-9]+"/g, () => `w14:paraId="${(++paragraphId).toString(16).padStart(8,'0')}"`);
    files[name] = encode.encode(text);
  }
  return new Blob([G.zip(files)], {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

export const contractDocx = (deal, customer, executor, buffer) => generate('contract', deal, customer, executor, buffer);
export const invoiceDocx = (deal, customer, executor, buffer) => generate('invoice', deal, customer, executor, buffer);
export const actDocx = (deal, customer, executor, buffer) => generate('act', deal, customer, executor, buffer);
