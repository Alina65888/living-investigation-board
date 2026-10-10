// Contracts, invoices, acts and UPD from one set of party cards and a deal.
// Pure functions (no DOM): grammar for Russian legal preambles, amounts in words, requisites checks,
// and template filling that preserves the approved Office packages.

// ---------- small helpers ----------
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const longDate = iso => { if (!iso) return '«___» __________ 20__ г.'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y} г.`; };
export const shortDate = iso => iso ? iso.split('-').reverse().join('.') : '';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const digits = s => String(s ?? '').replace(/\D/g, '');
export const money = n => (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const qty = n => String(+n || 0).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const sumItems = items => items.reduce((s, i) => s + Math.round((+i.qty || 0) * (+i.price || 0) * 100), 0) / 100;

// ---------- numbers in words ----------
const ONES = { m: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], f: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'] };
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
const SCALES = [null, ['тысяча', 'тысячи', 'тысяч', 'f'], ['миллион', 'миллиона', 'миллионов', 'm'], ['миллиард', 'миллиарда', 'миллиардов', 'm']];
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
function triad(n, gender) {
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, o = n % 10, w = [HUNDREDS[h]];
  if (t === 1) w.push(TEENS[o]); else w.push(TENS[t], ONES[gender][o]);
  return w.filter(Boolean).join(' ');
}
export function numberWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'ноль';
  const parts = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
    const t = n % 1000;
    if (!t) continue;
    const scale = SCALES[i];
    parts.unshift([triad(t, scale ? scale[3] : 'm'), scale ? plural(t, scale[0], scale[1], scale[2]) : ''].filter(Boolean).join(' '));
  }
  return parts.join(' ');
}
const kopecks = n => String(Math.round((+n || 0) * 100) % 100).padStart(2, '0');
// «24 000 (Двадцать четыре тысячи) руб. – 00 коп.»
export const amountWithWords = n => `${money(Math.floor(n)).replace(/,\d\d$/, '')} (${cap(numberWords(n))}) руб. – ${kopecks(n)} коп.`;
// «Двести две тысячи пятьсот шестьдесят руб. – 00 коп.»
export const amountWords = n => `${cap(numberWords(n))} руб. – ${kopecks(n)} коп.`;

// ---------- grammar of the preamble ----------
const ORG_NOUNS = { общество: 'n', организация: 'f', фонд: 'm', учреждение: 'n', ассоциация: 'f', союз: 'm', партнерство: 'n', партнёрство: 'n', движение: 'n', центр: 'm', предприятие: 'n', кооператив: 'm', компания: 'f', корпорация: 'f', объединение: 'n', палата: 'f', служба: 'f', институт: 'm', университет: 'm', школа: 'f', клуб: 'm', федерация: 'f', агентство: 'n', бюро: 'n', товарищество: 'n', учреждения: 'n' };
export function orgGender(name) {
  const words = String(name || '').toLowerCase().replace(/[«»"]/g, ' ').split(/[^а-яё]+/);
  for (const w of words) if (ORG_NOUNS[w]) return ORG_NOUNS[w];
  return 'f';
}
export function personGender(fio) {
  const [last = '', , patr = ''] = String(fio || '').trim().split(/\s+/);
  if (/(вич|ич|оглы|улы|уулу)$/i.test(patr)) return 'm';
  if (/(вна|чна|кызы|гызы)$/i.test(patr)) return 'f';
  return /[ая]$/i.test(last) ? 'f' : 'm';
}
const END = { named: { m: 'именуемый', f: 'именуемая', n: 'именуемое' }, acting: { m: 'действующий', f: 'действующая', n: 'действующее' }, actingGen: { m: 'действующего', f: 'действующей' }, registered: { m: 'зарегистрированный', f: 'зарегистрированная' } };

// Genitive of a signatory's position: «генеральный директор» → «генерального директора».
export function positionGenitive(pos) {
  const words = String(pos || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let nounDone = false;
  return words.map(w => {
    if (nounDone) return w;
    if (/(ый|ой)$/.test(w)) return w.replace(/(ый|ой)$/, 'ого');
    if (/ий$/.test(w)) return w.replace(/ий$/, /[гкхжчшщ]ий$/.test(w) ? 'ого' : 'его');
    nounDone = true;
    if (/ь$/.test(w)) return w.replace(/ь$/, 'я');
    if (/й$/.test(w)) return w.replace(/й$/, 'я');
    if (/а$/.test(w)) return w.replace(/а$/, /[гкхжчшщ]а$/.test(w) ? 'и' : 'ы');
    if (/[бвгджзклмнпрстфхцчшщ]$/.test(w)) return w + 'а';
    return w;
  }).join(' ');
}
// Male first names whose vowel drops or changes in the genitive.
const FIRST_M_GEN = { Пётр: 'Петра', Петр: 'Петра', Павел: 'Павла', Лев: 'Льва' };
// Genitive of a full name: «Сабирова Лиля Ринатовна» → «Сабировой Лили Ринатовны». Editable in the card.
export function fioGenitive(fio, gender = personGender(fio)) {
  const [last = '', first = '', patr = ''] = String(fio || '').trim().split(/\s+/);
  const soft = /[гкхжчшщ]$/;
  const lastG = gender === 'm'
    ? (/(ский|цкий)$/.test(last) ? last.replace(/ий$/, 'ого') : /ой$/.test(last) ? last.replace(/ой$/, 'ого') : /(ых|их|ко|о|е|и|у|ю|э)$/.test(last) ? last : /[ая]$/.test(last) ? last.replace(/а$/, soft.test(last.slice(0, -1)) ? 'и' : 'ы').replace(/я$/, 'и') : /[ьй]$/.test(last) ? last.replace(/[ьй]$/, 'я') : last + 'а')
    : (/(ова|ева|ёва|ина|ына)$/.test(last) ? last.replace(/а$/, 'ой') : /ская$/.test(last) ? last.replace(/ая$/, 'ой') : /ая$/.test(last) ? last.replace(/ая$/, 'ой') : /а$/.test(last) ? last.replace(/а$/, soft.test(last.slice(0, -1)) ? 'и' : 'ы') : /я$/.test(last) ? last.replace(/я$/, 'и') : last);
  const firstG = gender === 'm'
    ? FIRST_M_GEN[first] || (/[ьй]$/.test(first) ? first.replace(/[ьй]$/, 'я') : /а$/.test(first) ? first.replace(/а$/, soft.test(first.slice(0, -1)) ? 'и' : 'ы') : /я$/.test(first) ? first.replace(/я$/, 'и') : /[бвгджзклмнпрстфхцчшщ]$/.test(first) ? first + 'а' : first)
    : (/ия$/.test(first) ? first.replace(/ия$/, 'ии') : /я$/.test(first) ? first.replace(/я$/, 'и') : /а$/.test(first) ? first.replace(/а$/, soft.test(first.slice(0, -1)) ? 'и' : 'ы') : /ь$/.test(first) ? first.replace(/ь$/, 'и') : first);
  const patrG = gender === 'm' ? (/ич$/.test(patr) ? patr + 'а' : patr) : patr.replace(/на$/, 'ны');
  return [lastG, firstG, patrG].filter(Boolean).join(' ');
}
// «Соколов Сергей Владимирович» → «С. В. Соколов»
export const initials = fio => { const [last = '', first = '', patr = ''] = String(fio || '').trim().split(/\s+/); return [first && first[0] + '.', patr && patr[0] + '.', last].filter(Boolean).join(' '); };

// ---------- deal types ----------
export const DEAL_TYPES = {
  services: { title: 'оказания услуг', short: 'Услуги', exec: 'Исполнитель', execGen: 'Исполнителя', execDat: 'Исполнителю', cust: 'Заказчик', custGen: 'Заказчика', custDat: 'Заказчику', obj: 'Услуги', objAcc: 'Услуги', objGen: 'Услуг', verb: 'оказать', verbDone: 'оказаны', term: 'Срок оказания услуг', act: 'об оказании услуг', actTitle: 'оказанных услуг' },
  works: { title: 'подряда', short: 'Подряд', exec: 'Подрядчик', execGen: 'Подрядчика', execDat: 'Подрядчику', cust: 'Заказчик', custGen: 'Заказчика', custDat: 'Заказчику', obj: 'Работы', objAcc: 'Работы', objGen: 'Работ', verb: 'выполнить', verbDone: 'выполнены', term: 'Срок выполнения работ', act: 'сдачи-приемки выполненных работ', actTitle: 'выполненных работ', draft: true },
  supply: { title: 'поставки', short: 'Поставка', exec: 'Поставщик', execGen: 'Поставщика', execDat: 'Поставщику', cust: 'Покупатель', custGen: 'Покупателя', custDat: 'Покупателю', obj: 'Товары', objAcc: 'Товары', objGen: 'Товара', verb: 'поставить', verbDone: 'поставлены', term: 'Срок поставки', act: 'приема-передачи товара', actTitle: 'поставленного товара' }
};
export const PARTY_KINDS = { org: 'Организация', ip: 'ИП', npd: 'Самозанятый', person: 'Физлицо' };

// Who is the party and how it is introduced in the preamble.
export function partyPreamble(p, role) {
  if (p.kind === 'ip') { const g = p.gender || personGender(p.fio); return `Индивидуальный предприниматель ${p.fio}, ${END.acting[g]} на основании ОГРНИП ${p.ogrn}, ${END.named[g]} в дальнейшем «${role}»`; }
  if (p.kind === 'npd') { const g = 'm'; return `Самозанятый ${p.fio}, ${END.registered[g]} в качестве налогоплательщика налога на профессиональный доход от ${shortDate(p.npdDate)} № ${p.npdNumber}, ${END.named[g]} в дальнейшем «${role}»`; }
  if (p.kind === 'person') { const g = p.gender || personGender(p.fio); return `${g === 'f' ? 'Гражданка' : 'Гражданин'} Российской Федерации ${p.fio}, паспорт ${p.passport}, ${END.named[g]} в дальнейшем «${role}»`; }
  const og = orgGender(p.name), sg = p.signerGender || personGender(p.signer);
  return `${p.name}, в лице ${p.signerPositionGen || positionGenitive(p.signerPosition)} ${p.signerGen || fioGenitive(p.signer, sg)}, ${END.actingGen[sg]} на основании ${p.basis || 'устава'}, ${END.named[og]} в дальнейшем «${role}»`;
}
export const partyTitle = p => p.kind === 'org' ? p.name : p.kind === 'ip' ? `Индивидуальный предприниматель ${p.fio}` : p.fio;
export const vatPayer = p => (p.kind === 'org' || p.kind === 'ip') && !!p.vat;
export const vatRate = p => vatPayer(p) ? (+p.vatRate || 20) : 0;
export function vatAmount(total, p) { const r = vatRate(p); return r ? Math.round(total * r / (100 + r) * 100) / 100 : 0; }
export const vatLine = (total, p) => vatPayer(p) ? `В том числе НДС ${vatRate(p)}% — ${money(vatAmount(total, p))} руб.` : p.kind === 'npd' ? 'Сумма указана с учетом налога на профессиональный доход (НПД).' : 'НДС не облагается.';

// ---------- checks before generating ----------
function innOk(v) {
  const d = digits(v).split('').map(Number), k = (w, n) => w.slice(0, n).reduce((s, x, i) => s + x * d[i], 0) % 11 % 10;
  if (d.length === 10) return k([2, 4, 10, 3, 5, 9, 4, 6, 8], 9) === d[9];
  if (d.length === 12) return k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8], 10) === d[10] && k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8], 11) === d[11];
  return false;
}
function ogrnOk(v) {
  const s = digits(v);
  if (s.length === 13) return Number(BigInt(s.slice(0, 12)) % 11n % 10n) === +s[12];
  if (s.length === 15) return Number(BigInt(s.slice(0, 14)) % 13n % 10n) === +s[14];
  return false;
}
function accountOk(acc, bik, corr = false) {
  const a = digits(acc), b = digits(bik);
  if (a.length !== 20 || b.length !== 9) return false;
  const s = (corr ? '0' + b.slice(4, 6) : b.slice(-3)) + a, w = [7, 1, 3];
  return s.split('').reduce((t, x, i) => t + (+x * w[i % 3]) % 10, 0) % 10 === 0;
}
export function checkParty(p) {
  const out = [], who = partyTitle(p) || 'Сторона';
  const inn = digits(p.inn);
  if (p.kind === 'org' ? inn.length !== 10 : inn.length !== 12) out.push(`${who}: ИНН ${p.kind === 'org' ? 'организации — 10 цифр' : 'физлица и ИП — 12 цифр'}, указано ${inn.length || 'ничего'}.`);
  else if (!innOk(inn)) out.push(`${who}: ИНН ${inn} не проходит проверку контрольной суммы — вероятна опечатка.`);
  if (p.kind === 'org') {
    if (digits(p.kpp).length !== 9) out.push(`${who}: КПП — 9 цифр.`);
    if (!ogrnOk(p.ogrn) || digits(p.ogrn).length !== 13) out.push(`${who}: ОГРН организации — 13 цифр с верной контрольной цифрой.`);
    if (!p.signer) out.push(`${who}: не указан руководитель, который подписывает документы.`);
  }
  if (p.kind === 'ip' && (!ogrnOk(p.ogrn) || digits(p.ogrn).length !== 15)) out.push(`${who}: ОГРНИП — 15 цифр с верной контрольной цифрой.`);
  if (p.kind === 'npd' && (!p.npdDate || !p.npdNumber)) out.push(`${who}: укажите дату и номер постановки на учёт как плательщика НПД.`);
  if ((p.kind === 'npd' || p.kind === 'person') && !p.passport) out.push(`${who}: не указаны паспортные данные.`);
  if (p.account || p.bik) {
    if (digits(p.bik).length !== 9) out.push(`${who}: БИК — 9 цифр.`);
    else {
      if (!accountOk(p.account, p.bik)) out.push(`${who}: расчётный счёт не сходится с БИК — проверьте обе строки.`);
      if (p.corr && !accountOk(p.corr, p.bik, true)) out.push(`${who}: корреспондентский счёт не сходится с БИК.`);
    }
  } else out.push(`${who}: не указаны банковские реквизиты.`);
  if (!p.address) out.push(`${who}: не указан адрес.`);
  return out;
}
export function checkDeal(deal, customer, executor) {
  const out = [];
  if (!customer) out.push('Не выбран заказчик.');
  if (!executor) out.push('Не выбран исполнитель.');
  if (customer) out.push(...checkParty(customer));
  if (executor) out.push(...checkParty(executor));
  if (customer && executor && digits(customer.inn) && digits(customer.inn) === digits(executor.inn)) out.push('У заказчика и исполнителя одинаковый ИНН.');
  if (!deal.number) out.push('Не указан номер договора.');
  if (!deal.date) out.push('Не указана дата договора.');
  if (!deal.subject) out.push('Не описан предмет договора (для чего закупка).');
  if (!deal.items?.length) out.push('В спецификации нет позиций.');
  deal.items?.forEach((it, i) => { if (!it.name || !(+it.qty > 0) || !(+it.price > 0)) out.push(`Позиция ${i + 1}: нужны наименование, количество и цена.`); });
  if (deal.deadline && deal.date && deal.deadline < deal.date) out.push('Срок исполнения раньше даты договора.');
  if (executor?.kind === 'person') out.push('Договор с физлицом без статуса: организация удерживает НДФЛ 13% и платит страховые взносы. Уточните у бухгалтера.');
  if (deal.type === 'works') out.push('Шаблон договора подряда — черновик по образцу ваших договоров. Перед первым использованием покажите его юристу.');
  return out;
}

// ---------- OOXML: zip ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const enc = new TextEncoder(), dec = new TextDecoder();
// Stored (uncompressed) zip — valid for Word/Excel/LibreOffice and tiny to implement.
export function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const body = typeof data === 'string' ? enc.encode(data) : data, nm = enc.encode(name), crc = crc32(body);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [14, crc, 4], [18, body.length, 4], [22, body.length, 4], [26, nm.length, 2]].forEach(([o, v, s]) => s === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    parts.push(new Uint8Array(h.buffer), nm, body);
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [16, crc, 4], [20, body.length, 4], [24, body.length, 4], [28, nm.length, 2], [42, offset, 4]].forEach(([o, v, s]) => s === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    central.push(new Uint8Array(c.buffer), nm);
    offset += 30 + nm.length + body.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, Object.keys(files).length, 2], [10, Object.keys(files).length, 2], [12, size, 4], [16, offset, 4]].forEach(([o, v, s]) => s === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)]);
}
// Reads a stored zip (our template is saved without compression).
export function unzipStored(buf) {
  const v = new DataView(buf), u = new Uint8Array(buf), out = {};
  let p = 0;
  while (p + 30 <= u.length && v.getUint32(p, true) === 0x04034b50) {
    const method = v.getUint16(p + 8, true), size = v.getUint32(p + 18, true), nl = v.getUint16(p + 26, true), xl = v.getUint16(p + 28, true);
    if (method !== 0) throw new Error('Шаблон Office должен быть сохранён без сжатия');
    const name = dec.decode(u.subarray(p + 30, p + 30 + nl));
    out[name] = u.slice(p + 30 + nl + xl, p + 30 + nl + xl + size);
    p += 30 + nl + xl + size;
  }
  return out;
}

// Word output uses the original, anonymized Office packages.
export { contractDocx, invoiceDocx, actDocx, templateName, contractIssue } from './docx-templates.js?v=41';
const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- UPD (fills docs/templates/upd.xlsx) ----------
const UPD_FIRST = 21, UPD_ROWS = 6; // original approved form: six item rows, totals at 27
function setCell(sheet, ref, value, kind = 'str') {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>.*?</c>)`, 's');
  const m = sheet.match(re);
  if (!m) throw new Error('В шаблоне УПД нет ячейки ' + ref);
  const attrs = m[1].replace(/ t="[^"]*"/, '');
  let xml;
  if (value === '' || value == null) xml = `<c r="${ref}"${attrs}/>`;
  else if (kind === 'num') xml = `<c r="${ref}"${attrs}><v>${+value}</v></c>`;
  else if (kind === 'formula') xml = `<c r="${ref}"${attrs}><f>${x(value.f)}</f><v>${+value.v}</v></c>`;
  else xml = `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${x(value)}</t></is></c>`;
  return sheet.replace(re, xml);
}
const hideRow = (sheet, r) => sheet.replace(new RegExp(`<row r="${r}"([^>]*)>`), (m, a) => `<row r="${r}"${a.replace(/ hidden="1"/, '')} hidden="1">`);
function wrapUpdName(files, sheet, ref, value) {
  if (String(value).length <= 85 && !String(value).includes('\n')) return sheet;
  // The source signature cells have no wrapping. Long legal names need more
  // lines, preserving the source font, size, alignment, number format and borders.
  let styles = dec.decode(files['xl/styles.xml']);
  const group = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  const formats = [...group[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
  const cell = sheet.match(new RegExp(`<c r="${ref}"[^>]*>`))[0];
  let format = formats[+cell.match(/ s="(\d+)"/)[1]];
  format = format.replace(/<alignment([^>]*)\/>/, (_,attrs)=>`<alignment${attrs.replace(/ (wrapText|shrinkToFit)="[^"]*"/g,'')} wrapText="1"/>`);
  styles = styles.replace(group[0],`<cellXfs count="${formats.length+1}">${group[1]}${format}</cellXfs>`);
  files['xl/styles.xml'] = enc.encode(styles);
  sheet = sheet.replace(cell,cell.replace(/ s="\d+"/,` s="${formats.length}"`));
  const row = ref.replace(/[A-Z]/g,'');
  const height = (Math.ceil(String(value).length/85)+1)*12;
  return sheet.replace(new RegExp(`<row r="${row}"([^>]*)>`), (_,attrs)=> {
    const existing = +(attrs.match(/ ht="([^"]+)"/)?.[1] || 0);
    return `<row r="${row}"${attrs.replace(/ (ht|customHeight)="[^"]*"/g,'')} ht="${Math.max(height,existing)}" customHeight="1">`;
  });
}
function updRows(sheet, count) {
  const extra = Math.max(0, count - UPD_ROWS);
  if (!extra) return sheet;
  const row = sheet.match(/<row r="25"[^>]*>[\s\S]*?<\/row>/)[0];
  const merges = [...sheet.matchAll(/<mergeCell ref="([A-Z]+)25:([A-Z]+)25"\s*\/>/g)];
  // Move the totals and signature area together, including every merged range.
  sheet = sheet.replace(/\b(r|ref)="([^"]+)"/g, (m, attr, value) => {
    const shifted = value.replace(/(\$?[A-Z]+\$?)(\d+)/g, (v, col, n) => +n >= 27 ? col + (+n + extra) : v);
    return `${attr}="${attr === 'r' && /^\d+$/.test(value) && +value >= 27 ? +value + extra : shifted}"`;
  });
  const added = Array.from({length:extra}, (_,i) => row.replace(/(r=")(?:([A-Z]+))?25"/g, (_, lead, col='') => `${lead}${col}${27+i}"`)).join('');
  sheet = sheet.replace(new RegExp(`(<row r="${27+extra}")`), added + '$1');
  const addedMerges = Array.from({length:extra}, (_,i) => merges.map(m => `<mergeCell ref="${m[1]}${27+i}:${m[2]}${27+i}"/>`).join('')).join('');
  sheet = sheet.replace('</mergeCells>', addedMerges + '</mergeCells>');
  return sheet.replace(/<mergeCells count="\d+"/, `<mergeCells count="${[...sheet.matchAll(/<mergeCell /g)].length}"`);
}
const OKEI = { штука: '796', шт: '796', 'шт.': '796', услуга: '', комплект: '839', упаковка: '778', килограмм: '166', кг: '166', метр: '006', м: '006', литр: '112', л: '112', час: '356', 'кв. м': '055', пара: '715', набор: '704', рулон: '736', лист: '625', экземпляр: '' };
export function updXlsx(templateBuffer, deal, cust, exec) {
  const files = unzipStored(templateBuffer), t = DEAL_TYPES[deal.type], vat = vatPayer(exec), rate = vatRate(exec), goods = deal.type === 'supply';
  if (!files['xl/worksheets/sheet1.xml']) throw new Error('Не найден лист шаблона УПД');
  const count = Math.max(UPD_ROWS, deal.items.length), totalRow = UPD_FIRST + count;
  const R = row => row >= 27 ? row + count - UPD_ROWS : row;
  let s = updRows(dec.decode(files['xl/worksheets/sheet1.xml']), deal.items.length);
  const set = (ref, v, k) => { s = setCell(s, ref, v, k); };
  const fio = exec.kind === 'org' ? exec.signer : exec.fio, short = f => { const [l = '', a = '', b = ''] = String(f || '').split(/\s+/); return `${l} ${a ? a[0] + '.' : ''}${b ? b[0] + '.' : ''}`.trim(); };
  const date = deal.updDate || deal.actDate || deal.deadline || deal.date;
  set('R2', deal.updNumber || deal.number); set('AA2', shortDate(date));
  set('R3', '–'); set('AA3', '–');
  set('C6', vat ? '1' : '2');
  set('Y5', partyTitle(exec)); set('Y6', exec.address); set('Y7', exec.kind === 'org' ? `${digits(exec.inn)} / ${digits(exec.kpp)}` : digits(exec.inn));
  set('Y8', goods ? 'он же' : '–'); set('Y9', goods ? `${partyTitle(cust)}, ${cust.address}` : '–');
  set('AA10', '–'); set('AK10', '–');
  set('Y12', partyTitle(cust)); set('Y13', cust.address); set('Y14', cust.kind === 'org' ? `${digits(cust.inn)} / ${digits(cust.kpp)}` : digits(cust.inn));
  let net = 0, tax = 0;
  for (let i = 0; i < count; i++) {
    const r = UPD_FIRST + i, it = deal.items[i];
    if (!it) { s = hideRow(s, r); continue; }
    const sum = Math.round(it.qty * it.price * 100) / 100, itTax = vat ? Math.round(sum * rate / (100 + rate) * 100) / 100 : 0;
    net += sum - itTax; tax += itTax;
    const description = [it.name, it.description].filter(Boolean).join('\n');
    set(`I${r}`, i + 1, 'num'); set(`L${r}`, description); set(`R${r}`, '–');
    const code = OKEI[String(it.unit || '').toLowerCase().trim()];
    set(`U${r}`, code || '–'); set(`W${r}`, it.unit || '–');
    set(`AD${r}`, +it.qty, 'num'); set(`AH${r}`, vat ? Math.round((it.price - it.price * rate / (100 + rate)) * 100) / 100 : +it.price, 'num');
    set(`AM${r}`, Math.round((sum - itTax) * 100) / 100, 'num');
    set(`AT${r}`, 'без акциза');
    set(`AX${r}`, vat ? `${rate}%` : 'без НДС'); set(`BB${r}`, vat ? itTax : 'без НДС', vat ? 'num' : 'str');
    set(`BH${r}`, sum, 'num');
    set(`BO${r}`, '–'); set(`BS${r}`, '–'); set(`BZ${r}`, '–');
  }
  const total = sumItems(deal.items);
  set(`AO${totalRow}`, Math.round(net * 100) / 100, 'num'); set(`BD${totalRow}`, vat ? Math.round(tax * 100) / 100 : 'без НДС', vat ? 'num' : 'str'); set(`BJ${totalRow}`, total, 'num');
  set(`A${R(30)}`, ''); // pagination depends on the user's printer; do not assert one page
  if (exec.kind === 'org') { set(`AG${R(29)}`, short(fio)); set(`BS${R(29)}`, short(exec.accountant || fio)); set(`AG${R(31)}`, ''); set(`AY${R(31)}`, ''); }
  else { set(`AG${R(29)}`, ''); set(`BS${R(29)}`, ''); set(`AG${R(31)}`, short(fio)); set(`AY${R(31)}`, `ОГРНИП ${exec.ogrn || ''}`); }
  set(`W${R(34)}`, `Договор ${t.title} № ${deal.number} от ${shortDate(deal.date)}`);
  set(`Q${R(36)}`, '–');
  const execPos = exec.kind === 'org' ? cap(exec.signerPosition || 'Директор') : 'Индивидуальный предприниматель', custPos = cust.kind === 'org' ? cap(cust.signerPosition || 'Директор') : cust.kind === 'ip' ? 'ИП' : '';
  const custFio = cust.kind === 'org' ? cust.signer : cust.fio;
  for (const row of [39, 46]) { set(`A${R(row)}`, execPos === 'Индивидуальный предприниматель' ? 'ИП' : execPos); set(`Z${R(row)}`, short(fio)); set(`AR${R(row)}`, custPos); set(`BR${R(row)}`, short(custFio)); }
  set(`A${R(49)}`, exec.shortName || partyTitle(exec)); set(`AR${R(49)}`, cust.shortName || partyTitle(cust));
  s = wrapUpdName(files, s, `A${R(49)}`, exec.shortName || partyTitle(exec));
  s = wrapUpdName(files, s, `AR${R(49)}`, cust.shortName || partyTitle(cust));
  if (date) {
    const [year, month, day] = date.split('-');
    for (const [col, value] of [['Q',day],['T',MONTHS[+month-1]],['Z',year.slice(0,2)],['AB',year.slice(2)],['BF',day],['BL',MONTHS[+month-1]],['BW',year.slice(0,2)],['BX',year.slice(2)]]) set(`${col}${R(41)}`, value);
  }
  let workbook = dec.decode(files['xl/workbook.xml']);
  const printArea = `<definedName name="_xlnm.Print_Area" localSheetId="0">'Счет-фактура'!$A$1:$CG$${R(51)}</definedName>`;
  workbook = workbook.replace('</definedNames>',printArea+'</definedNames>');
  files['xl/workbook.xml'] = enc.encode(workbook);
  files['xl/worksheets/sheet1.xml'] = enc.encode(s);
  return new Blob([zip(files)], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

// Which documents make sense for this executor.
export function documentSet(exec) {
  if (!exec) return [];
  const list = [{ id: 'contract', title: 'Договор и спецификация', ext: 'docx' }];
  if (exec.kind === 'org' || exec.kind === 'ip') list.push({ id: 'invoice', title: 'Счёт на оплату', ext: 'docx' });
  list.push({ id: 'act', title: 'Акт', ext: 'docx' });
  if (exec.kind === 'org' || exec.kind === 'ip') list.push({ id: 'upd', title: 'УПД', ext: 'xlsx' });
  return list;
}
