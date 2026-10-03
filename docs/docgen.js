// Contracts, invoices, acts and UPD from one set of party cards and a deal.
// Pure functions (no DOM): grammar for Russian legal preambles, amounts in words, requisites checks,
// and minimal OOXML writers (DOCX from scratch, UPD by filling docs/templates/upd.xlsx).

// ---------- small helpers ----------
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const longDate = iso => { if (!iso) return '«___» __________ 20__ г.'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y} г.`; };
export const shortDate = iso => iso ? iso.split('-').reverse().join('.') : '';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const digits = s => String(s ?? '').replace(/\D/g, '');
export const money = n => (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const qty = n => String(+n || 0).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const sumItems = items => Math.round(items.reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0), 0) * 100) / 100;

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
  if (p.kind === 'npd') { const g = p.gender || personGender(p.fio); return `${g === 'f' ? 'Гражданка' : 'Гражданин'} ${p.fio}, ${END.registered[g]} в качестве налогоплательщика налога на профессиональный доход от ${shortDate(p.npdDate)} № ${p.npdNumber}, ${END.named[g]} в дальнейшем «${role}»`; }
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
    if (method !== 0) throw new Error('Шаблон УПД должен быть сохранён без сжатия');
    const name = dec.decode(u.subarray(p + 30, p + 30 + nl));
    out[name] = u.slice(p + 30 + nl + xl, p + 30 + nl + xl + size);
    p += 30 + nl + xl + size;
  }
  return out;
}

// ---------- OOXML: docx ----------
const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// run(text, {b, i, size}) — text may contain \n for line breaks
const run = (text, o = {}) => `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.u ? '<w:u w:val="single"/>' : ''}${o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : ''}</w:rPr>${String(text ?? '').split('\n').map((t, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(t)}</w:t>`).join('')}</w:r>`;
// p(content, {align, indent, after, before, keep}) — content: string or array of [text, opts]
function p(content, o = {}) {
  const runs = Array.isArray(content) ? content.map(c => Array.isArray(c) ? run(c[0], c[1]) : run(c)).join('') : run(content, o.r);
  const ppr = `<w:pPr>${o.keep ? '<w:keepNext/>' : ''}<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}"/>${o.indent ? `<w:ind w:firstLine="${o.indent}"/>` : ''}<w:jc w:val="${o.align || 'both'}"/></w:pPr>`;
  return `<w:p>${ppr}${runs}</w:p>`;
}
const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
// table(rows, {widths, borders, header}) — rows: arrays of cells; cell: string | {t, b, align, span, runs}
function table(rows, o = {}) {
  const total = o.widths.reduce((a, b) => a + b, 0), b = o.borders !== false;
  const borders = b ? '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('') + '</w:tblBorders>' : '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="nil"/>`).join('') + '</w:tblBorders>';
  const grid = `<w:tblGrid>${o.widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const trs = rows.map(r => {
    let col = 0;
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map(c => {
      const cell = typeof c === 'object' && c !== null && !Array.isArray(c) ? c : { t: c }, span = cell.span || 1;
      const w = o.widths.slice(col, col + span).reduce((a, b) => a + b, 0); col += span;
      const body = cell.paras || [p(cell.runs || [[cell.t ?? '', { b: cell.b, size: cell.size }]], { align: cell.align || 'left' })];
      return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vAlign w:val="${cell.valign || 'top'}"/></w:tcPr>${body.join('')}</w:tc>`;
    }).join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${trs}</w:tbl>`;
}
function docx(bodyXml, { title = 'Документ', fontSize = 11 } = {}) {
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title)}</dc:title><dc:creator>Living Project HQ</dc:creator></cp:coreProperties>`,
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="${fontSize * 2}"/><w:szCs w:val="${fontSize * 2}"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`
  });
}

// ---------- shared blocks ----------
const W = 9638; // text width in twips (A4 minus margins)
function requisites(p) {
  const rows = [];
  if (p.kind === 'org') rows.push(['ОГРН', p.ogrn], ['ИНН / КПП', `${digits(p.inn)} / ${digits(p.kpp)}`]);
  if (p.kind === 'ip') rows.push(['ОГРНИП', p.ogrn], ['ИНН', digits(p.inn)]);
  if (p.kind === 'npd' || p.kind === 'person') rows.push(['Паспорт', p.passport], ['ИНН', digits(p.inn)]);
  rows.push(['Адрес', p.address], ['Р/с', p.account], ['Банк', p.bank], ['К/с', p.corr], ['БИК', p.bik]);
  if (p.email) rows.push(['E-mail', p.email]);
  if (p.phone) rows.push(['Телефон', p.phone]);
  return rows;
}
function signerLine(p) {
  if (p.kind === 'org') return { pos: cap(p.signerPosition || 'Директор'), name: initials(p.signer), stamp: true };
  if (p.kind === 'ip') return { pos: 'Индивидуальный предприниматель', name: initials(p.fio), stamp: true };
  return { pos: p.fio, name: initials(p.fio), stamp: false };
}
function signatures(left, right) {
  const cell = s => ({ paras: [p(s.pos, { align: 'left' }), p(' ', {}), p(`_________________ / ${s.name}`, { align: 'left' }), p(s.stamp ? 'М. П.' : ' ', { align: 'left' })] });
  return table([[cell(signerLine(left)), cell(signerLine(right))]], { widths: [W / 2, W / 2], borders: false });
}
function partiesTable(cust, exec, t) {
  const L = requisites(cust), R = requisites(exec), n = Math.max(L.length, R.length), rows = [[{ t: `${t.cust}:\n${partyTitle(cust)}`, b: true, span: 2 }, { t: `${t.exec}:\n${partyTitle(exec)}`, b: true, span: 2 }]];
  for (let i = 0; i < n; i++) rows.push([L[i]?.[0] || '', L[i]?.[1] || '', R[i]?.[0] || '', R[i]?.[1] || '']);
  return table(rows, { widths: [1300, 3519, 1300, 3519] });
}
function specTable(deal, exec) {
  const total = sumItems(deal.items);
  const rows = [[{ t: '№', b: true, align: 'center' }, { t: 'Наименование', b: true, align: 'center' }, { t: 'Ед. изм.', b: true, align: 'center' }, { t: 'Кол-во', b: true, align: 'center' }, { t: 'Цена за ед. (руб.)', b: true, align: 'center' }, { t: 'Сумма (руб.)', b: true, align: 'center' }]];
  deal.items.forEach((it, i) => rows.push([{ t: String(i + 1), align: 'center' }, { runs: [[it.name + (it.description ? '.' : ''), { b: true }], ...(it.description ? [[' ' + it.description]] : [])] }, { t: it.unit || '', align: 'center' }, { t: qty(it.qty), align: 'center' }, { t: money(it.price), align: 'right' }, { t: money(it.qty * it.price), align: 'right' }]));
  rows.push([{ t: vatPayer(exec) ? `ИТОГО, в т. ч. НДС ${vatRate(exec)}% (${money(vatAmount(total, exec))}):` : exec.kind === 'npd' ? 'ИТОГО (с учетом НПД):' : 'ИТОГО без НДС:', b: true, span: 5, align: 'right' }, { t: money(total), b: true, align: 'right' }]);
  return table(rows, { widths: [500, 4438, 1000, 900, 1400, 1400] });
}
const placeDate = (city, date) => table([[{ t: `г. ${city || 'Казань'}` }, { t: longDate(date), align: 'right' }]], { widths: [W / 2, W / 2], borders: false });
const h = (text, o = {}) => p([[text, { b: true }]], { align: 'center', before: o.before ?? 160, after: 80, keep: true });
const cl = (num, text) => p(`${num} ${text}`, { indent: 567 });
const contractRef = (deal, t) => `Договору ${t.title} № ${deal.number} от ${longDate(deal.date)}`;

// ---------- contract ----------
export function contractDocx(deal, cust, exec) {
  const t = DEAL_TYPES[deal.type], total = sumItems(deal.items), npd = exec.kind === 'npd', days = deal.payDays || 15;
  const B = [];
  B.push(p([['ДОГОВОР', { b: true, size: 12 }]], { align: 'center' }), p([[`${t.title} № ${deal.number}`, { b: true, size: 12 }]], { align: 'center', after: 160 }));
  B.push(placeDate(deal.city, deal.date), p('', { after: 120 }));
  B.push(p(`${partyPreamble(exec, t.exec)}, с одной стороны, и`, { indent: 567 }));
  B.push(p(`${partyPreamble(cust, t.cust)}, с другой стороны,`, { indent: 567 }));
  B.push(p('совместно именуемые «Стороны», заключили настоящий договор, в дальнейшем «Договор», о нижеследующем:', { indent: 567 }));
  B.push(h('1. ПРЕДМЕТ ДОГОВОРА'));
  const period = deal.period ? ` ${deal.period}` : '';
  if (deal.type === 'supply') B.push(cl('1.1.', `${t.exec} обязуется поставить в течение срока действия Договора Товары согласно Спецификации (Приложение № 1 к настоящему Договору): ${deal.subject}${period}, а ${t.cust} в случае отсутствия мотивированных возражений обязуется принять и оплатить Товары.`));
  else if (deal.type === 'works') B.push(cl('1.1.', `${t.exec} обязуется по заданию Заказчика выполнить Работы согласно Спецификации (Приложение № 1 к настоящему Договору): ${deal.subject}${period}, и сдать их результат Заказчику, а Заказчик обязуется принять результат Работ и оплатить его.`));
  else B.push(cl('1.1.', `${t.exec} обязуется по заданию Заказчика оказать Услуги согласно Спецификации (Приложение № 1 к настоящему Договору): ${deal.subject}${period}, а Заказчик в случае отсутствия мотивированных возражений обязуется принять и оплатить Услуги.`));
  B.push(h('2. ПРАВА И ОБЯЗАННОСТИ СТОРОН'));
  B.push(cl('2.1.', 'При исполнении Договора Стороны обязуются принимать во внимание предлагаемые друг другу рекомендации, указанные в Спецификации и касающиеся предмета Договора.'));
  B.push(cl('2.2.', `${t.exec} обязуется:`));
  B.push(cl('2.2.1.', `надлежащим образом ${t.verb} ${t.objAcc} надлежащего качества, перечисленные в п. 1.1 Договора и в Спецификации, являющейся неотъемлемой частью Договора;`));
  if (deal.type === 'works') B.push(cl('2.2.2.', 'передать Заказчику результат Работ по Акту сдачи-приемки выполненных работ и устранить за свой счет недостатки, выявленные при приемке;'));
  if (npd) B.push(cl(deal.type === 'works' ? '2.2.3.' : '2.2.2.', 'в течение 3 (Трех) рабочих дней после получения оплаты передать Заказчику чек, сформированный в приложении «Мой налог», и незамедлительно письменно уведомить Заказчика о снятии с учета в качестве налогоплательщика налога на профессиональный доход.'));
  B.push(cl('2.3.', `${t.exec} имеет право:`));
  B.push(cl('2.3.1.', `требовать и получать от ${t.custGen} все необходимые для исполнения Договора сведения.`));
  B.push(cl('2.4.', `${t.cust} обязуется:`));
  B.push(cl('2.4.1.', 'своевременно производить оплату в соответствии с условиями Договора.'));
  B.push(cl('2.5.', `${t.cust} имеет право:`));
  B.push(cl('2.5.1.', deal.type === 'supply' ? `во всякое время проверять качество Товаров, поставляемых ${t.execGen === 'Поставщика' ? 'Поставщиком' : t.exec}, не вмешиваясь в его деятельность.` : deal.type === 'works' ? 'во всякое время проверять ход и качество выполняемых Работ, не вмешиваясь в деятельность Подрядчика.' : 'во всякое время проверять качество оказываемых Услуг, не вмешиваясь в деятельность Исполнителя.'));
  B.push(h('3. СТОИМОСТЬ И ПОРЯДОК ОПЛАТЫ'));
  B.push(cl('3.1.', `Стоимость по Договору составляет ${amountWithWords(total)} ${vatLine(total, exec)} Стоимость согласована Сторонами в Спецификации, являющейся неотъемлемой частью Договора.`));
  B.push(cl('3.2.', `${t.cust} оплачивает стоимость по Договору путем перечисления денежных средств на расчетный счет ${t.execGen} в размере 100% в течение ${days} (${cap(numberWords(days))}) рабочих дней с момента подписания ${npd || deal.type !== 'supply' ? (deal.type === 'works' ? 'Акта сдачи-приемки выполненных работ' : 'Акта об исполнении обязательств') : 'универсального передаточного документа (УПД) или товарной накладной'}.`));
  B.push(cl('3.3.', `Договор считается оплаченным с даты списания денежных средств, предусмотренных п. 3.1 Договора, с расчетного счета ${t.custGen}.`));
  B.push(cl('3.4.', 'На сумму предоплаты или аванса проценты по денежным обязательствам согласно ст. 317.1 ГК РФ не начисляются и не оплачиваются.'));
  B.push(cl('3.5.', `В случае несвоевременного исполнения ${t.custGen === 'Покупателя' ? 'Покупателем' : 'Заказчиком'} обязательств по оплате ${t.exec} вправе взыскать проценты за пользование чужими денежными средствами в соответствии со ст. 395 ГК РФ.`));
  B.push(h('4. ОТВЕТСТВЕННОСТЬ СТОРОН'));
  B.push(cl('4.1.', 'В случае неисполнения либо ненадлежащего исполнения принятых на себя обязательств по Договору Сторона, допустившая указанные нарушения, несет ответственность в соответствии с законодательством Российской Федерации.'));
  B.push(cl('4.2.', 'Ни одна из Сторон не несет ответственности за невыполнение каких-либо своих обязательств по Договору, если такое невыполнение вызвано или возникает в результате форс-мажорных обстоятельств.'));
  B.push(cl('4.3.', 'При наступлении форс-мажорных обстоятельств срок исполнения обязательств по Договору изменяется соразмерно времени, в течение которого действовали такие обстоятельства.'));
  if (deal.type === 'works') B.push(cl('4.4.', 'Подрядчик отвечает за недостатки результата Работ, обнаруженные в течение 6 (Шести) месяцев с даты подписания Акта сдачи-приемки выполненных работ, и обязан устранить их своими силами и за свой счет в разумный срок.'));
  B.push(h('5. СРОК ДЕЙСТВИЯ ДОГОВОРА'));
  B.push(cl('5.1.', `Договор вступает в силу с момента его подписания Сторонами и действует до полного исполнения Сторонами принятых на себя обязательств.${deal.deadline ? ` ${t.term} — не позднее ${longDate(deal.deadline)}` : ''}`));
  B.push(cl('5.2.', 'Договор может быть расторгнут по взаимному соглашению Сторон либо по решению одной из Сторон, но не ранее проведения полного взаимного расчета с предъявлением подтверждающих документов. Сторона, намеренная расторгнуть Договор, обязана предупредить другую Сторону об этом за 15 (Пятнадцать) календарных дней до момента расторжения Договора.'));
  B.push(h('6. ДОПОЛНИТЕЛЬНЫЕ УСЛОВИЯ'));
  B.push(cl('6.1.', 'Все изменения и дополнения к Договору действительны лишь в том случае, если они оформлены в письменном виде и подписаны Сторонами.'));
  B.push(cl('6.2.', 'В случае изменения своего адреса, счета или обслуживающего банка Стороны обязаны в 5-дневный срок уведомить об этом друг друга.'));
  B.push(cl('6.3.', 'Разногласия по Договору разрешаются путем переговоров, а при невозможности — в суде в порядке, установленном законодательством Российской Федерации.'));
  B.push(cl('6.4.', 'Договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному экземпляру для каждой из Сторон.'));
  B.push(h('7. РЕКВИЗИТЫ И ПОДПИСИ СТОРОН'));
  B.push(partiesTable(cust, exec, t), p('', { after: 120 }), signatures(cust, exec));
  // Appendix 1 — specification
  B.push(pageBreak());
  B.push(p('Приложение № 1', { align: 'right' }), p(`к Договору ${t.title}`, { align: 'right' }), p(`№ ${deal.number} от ${longDate(deal.date)}`, { align: 'right', after: 200 }));
  B.push(p([['СПЕЦИФИКАЦИЯ № 1', { b: true }]], { align: 'center', after: 160 }));
  B.push(placeDate(deal.city, deal.date), p('', { after: 120 }));
  B.push(specTable(deal, exec), p('', { after: 120 }));
  B.push(p(`Порядок расчетов: оплата производится ${t.custGen === 'Покупателя' ? 'Покупателем' : 'Заказчиком'} путем перечисления денежных средств на расчетный счет ${t.execGen} в размере 100% в соответствии с п. 3.2 Договора.`, { indent: 567 }));
  B.push(p(`Общая стоимость настоящего Приложения составляет: ${amountWithWords(total)} ${vatLine(total, exec)}`, { indent: 567 }));
  if (deal.deadline) B.push(p(`${t.term}: ${longDate(deal.deadline)}`, { indent: 567 }));
  B.push(p('', { after: 240 }), signatures(cust, exec));
  return docx(B.join(''), { title: `Договор ${t.title} № ${deal.number}` });
}

// ---------- invoice ----------
export function invoiceDocx(deal, cust, exec) {
  const t = DEAL_TYPES[deal.type], total = sumItems(deal.items), B = [];
  B.push(p([[`Счет на оплату № ${deal.invoiceNumber || deal.number} от ${longDate(deal.invoiceDate || deal.date)}`, { b: true, size: 14 }]], { align: 'left', after: 200 }));
  B.push(table([
    [{ t: 'Получатель:', b: true }, `${partyTitle(exec)}, ИНН ${digits(exec.inn)}${exec.kind === 'org' ? `, КПП ${digits(exec.kpp)}` : ''}`],
    [{ t: 'Банк получателя:', b: true }, `${exec.bank}, БИК ${exec.bik}, к/с ${exec.corr}, р/с ${exec.account}`],
    [{ t: 'Плательщик:', b: true }, `${partyTitle(cust)}, ИНН ${digits(cust.inn)}${cust.kind === 'org' ? `, КПП ${digits(cust.kpp)}` : ''}`],
    [{ t: 'Основание:', b: true }, `Договор ${t.title} № ${deal.number} от ${shortDate(deal.date)}`]
  ], { widths: [2200, W - 2200], borders: false }), p('', { after: 160 }));
  const rows = [[{ t: '№', b: true, align: 'center' }, { t: 'Наименование товаров, работ, услуг', b: true, align: 'center' }, { t: 'Кол-во', b: true, align: 'center' }, { t: 'Ед. изм.', b: true, align: 'center' }, { t: 'Цена (руб.)', b: true, align: 'center' }, { t: 'Сумма (руб.)', b: true, align: 'center' }]];
  deal.items.forEach((it, i) => rows.push([{ t: String(i + 1), align: 'center' }, it.name, { t: qty(it.qty), align: 'center' }, { t: it.unit || '', align: 'center' }, { t: money(it.price), align: 'right' }, { t: money(it.qty * it.price), align: 'right' }]));
  B.push(table(rows, { widths: [500, 4638, 900, 1000, 1300, 1300] }), p('', { after: 60 }));
  B.push(table([
    [{ t: 'Итого:', b: true, align: 'right' }, { t: money(total), b: true, align: 'right' }],
    [{ t: vatPayer(exec) ? `В том числе НДС ${vatRate(exec)}%:` : 'НДС:', b: true, align: 'right' }, { t: vatPayer(exec) ? money(vatAmount(total, exec)) : 'не облагается', align: 'right' }],
    [{ t: 'Всего к оплате:', b: true, align: 'right' }, { t: money(total), b: true, align: 'right' }]
  ], { widths: [W - 1800, 1800], borders: false }));
  B.push(p(`Всего наименований ${deal.items.length} на сумму ${money(total)} руб.`, { before: 160 }), p([[amountWords(total), { b: true }]], { after: 400 }));
  const s = signerLine(exec);
  B.push(table([[s.pos, { t: `_________________ / ${s.name}`, align: 'right' }]], { widths: [W / 2, W / 2], borders: false }));
  return docx(B.join(''), { title: `Счет № ${deal.invoiceNumber || deal.number}` });
}

// ---------- act ----------
export function actDocx(deal, cust, exec) {
  const t = DEAL_TYPES[deal.type], total = sumItems(deal.items), npd = exec.kind === 'npd', B = [], ref = contractRef(deal, t);
  B.push(p([['АКТ', { b: true, size: 12 }]], { align: 'center' }), p([[deal.type === 'works' ? `сдачи-приемки выполненных работ по ${ref}` : `об исполнении обязательств по ${ref}`, { b: true }]], { align: 'center', after: 160 }));
  B.push(placeDate(deal.city, deal.actDate || deal.deadline), p('', { after: 120 }));
  B.push(p(`${partyPreamble(exec, t.exec)}, с одной стороны, и`, { indent: 567 }));
  B.push(p(`${partyPreamble(cust, t.cust)}, с другой стороны,`, { indent: 567 }));
  B.push(p('совместно именуемые «Стороны», составили и подписали настоящий акт, в дальнейшем «Акт», о нижеследующем:', { indent: 567 }));
  const period = deal.period ? ` ${deal.period}` : '';
  B.push(p(`1. ${t.objAcc} по ${ref}${period} ${t.verbDone} ${t.execGen === 'Поставщика' ? 'Поставщиком' : t.exec === 'Подрядчик' ? 'Подрядчиком' : 'Исполнителем'} в полном объеме в соответствии со Спецификацией № 1 (Приложение № 1 к Договору):`, { indent: 567, before: 120 }));
  B.push(specTable(deal, exec), p('', { after: 120 }));
  B.push(p(`2. Стоимость составляет ${amountWithWords(total)} ${vatLine(total, exec)}`, { indent: 567 }));
  B.push(p(deal.paid ? `3. ${t.cust} оплатил стоимость в полном объеме. Обязательства Сторон по Договору исполнены.` : `3. Оплата производится в соответствии с п. 3.2 Договора.`, { indent: 567 }));
  B.push(p(`4. ${t.cust} претензий по объему, качеству и срокам ${deal.type === 'supply' ? 'поставки' : deal.type === 'works' ? 'выполнения работ' : 'оказания услуг'} не имеет.`, { indent: 567 }));
  if (npd) B.push(p('5. Исполнитель является плательщиком налога на профессиональный доход и передает Заказчику чек, сформированный в приложении «Мой налог».', { indent: 567 }));
  B.push(p(`${npd ? 6 : 5}. Акт составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из Сторон.`, { indent: 567 }));
  B.push(h('РЕКВИЗИТЫ И ПОДПИСИ СТОРОН'), partiesTable(cust, exec, t), p('', { after: 120 }), signatures(cust, exec));
  return docx(B.join(''), { title: `Акт по договору № ${deal.number}` });
}

// ---------- UPD (fills docs/templates/upd.xlsx) ----------
const UPD_FIRST = 21, UPD_ROWS = 40, UPD_TOTAL = UPD_FIRST + UPD_ROWS; // totals row 61; rows below the items shifted by +35
const R = r => r >= 26 ? r + UPD_ROWS - 5 : r; // template row numbers from the original form
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
const OKEI = { штука: '796', шт: '796', 'шт.': '796', услуга: '', комплект: '839', упаковка: '778', килограмм: '166', кг: '166', метр: '006', м: '006', литр: '112', л: '112', час: '356', 'кв. м': '055', пара: '715', набор: '704', рулон: '736', лист: '625', экземпляр: '' };
export function updXlsx(templateBuffer, deal, cust, exec) {
  const files = unzipStored(templateBuffer), t = DEAL_TYPES[deal.type], vat = vatPayer(exec), rate = vatRate(exec), goods = deal.type === 'supply';
  let s = dec.decode(files['xl/worksheets/sheet1.xml']);
  const set = (ref, v, k) => { s = setCell(s, ref, v, k); };
  const fio = exec.kind === 'org' ? exec.signer : exec.fio, short = f => { const [l = '', a = '', b = ''] = String(f || '').split(/\s+/); return `${l} ${a ? a[0] + '.' : ''}${b ? b[0] + '.' : ''}`.trim(); };
  set('R2', deal.updNumber || deal.number); set('AA2', shortDate(deal.updDate || deal.deadline || deal.date));
  set('R3', '–'); set('AA3', '–');
  set('C6', vat ? '1' : '2');
  set('Y5', partyTitle(exec)); set('Y6', exec.address); set('Y7', exec.kind === 'org' ? `${digits(exec.inn)} / ${digits(exec.kpp)}` : digits(exec.inn));
  set('Y8', goods ? 'он же' : '–'); set('Y9', goods ? `${partyTitle(cust)}, ${cust.address}` : '–');
  set('AA10', '–'); set('AK10', '–');
  set('Y12', partyTitle(cust)); set('Y13', cust.address); set('Y14', cust.kind === 'org' ? `${digits(cust.inn)} / ${digits(cust.kpp)}` : digits(cust.inn));
  if (deal.items.length > UPD_ROWS) throw new Error(`В УПД помещается ${UPD_ROWS} позиций, а в спецификации ${deal.items.length}`);
  let net = 0, tax = 0;
  for (let i = 0; i < UPD_ROWS; i++) {
    const r = UPD_FIRST + i, it = deal.items[i];
    if (!it) { s = hideRow(s, r); continue; }
    const sum = Math.round(it.qty * it.price * 100) / 100, itTax = vat ? Math.round(sum * rate / (100 + rate) * 100) / 100 : 0;
    net += sum - itTax; tax += itTax;
    set(`I${r}`, i + 1, 'num'); set(`L${r}`, it.name); set(`R${r}`, '–');
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
  set(`AO${UPD_TOTAL}`, Math.round(net * 100) / 100, 'num'); set(`BD${UPD_TOTAL}`, vat ? Math.round(tax * 100) / 100 : 'без НДС', vat ? 'num' : 'str'); set(`BJ${UPD_TOTAL}`, total, 'num');
  set(`A${R(29)}`, '1');
  if (exec.kind === 'org') { set(`AG${R(28)}`, short(fio)); set(`BS${R(28)}`, short(exec.accountant || fio)); set(`AG${R(30)}`, ''); set(`AY${R(30)}`, ''); }
  else { set(`AG${R(28)}`, ''); set(`BS${R(28)}`, ''); set(`AG${R(30)}`, short(fio)); set(`AY${R(30)}`, `ОГРНИП ${exec.ogrn}`); }
  set(`W${R(33)}`, `Договор ${t.title} № ${deal.number} от ${shortDate(deal.date)}`);
  set(`Q${R(35)}`, '–');
  const execPos = exec.kind === 'org' ? cap(exec.signerPosition || 'Директор') : 'Индивидуальный предприниматель', custPos = cust.kind === 'org' ? cap(cust.signerPosition || 'Директор') : cust.kind === 'ip' ? 'ИП' : '';
  const custFio = cust.kind === 'org' ? cust.signer : cust.fio;
  for (const row of [38, 45]) { set(`A${R(row)}`, execPos === 'Индивидуальный предприниматель' ? 'ИП' : execPos); set(`Z${R(row)}`, short(fio)); set(`AR${R(row)}`, custPos); set(`BR${R(row)}`, short(custFio)); }
  set(`A${R(48)}`, `${partyTitle(exec)}, ИНН ${digits(exec.inn)}`); set(`AR${R(48)}`, `${partyTitle(cust)}, ИНН ${digits(cust.inn)}`);
  files['xl/worksheets/sheet1.xml'] = enc.encode(s);
  return zip(files);
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
