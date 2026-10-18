// Recipient files are read locally. Only the reviewed names are saved with a letter.
import {crc32} from './docgen.js?v=60';

export const MAX_RECIPIENTS=200;
const MAX_FILE=5*1024*1024,MAX_UNPACKED=20*1024*1024,MAX_ROWS=5000,MAX_COLS=128;
export const cleanName=value=>String(value??'').replace(/\s+/gu,' ').trim();
export const nameLines=text=>String(text).split(/\r?\n/).map(cleanName).filter(Boolean);
export function checkNames(names){
  if(!names.length)throw Error('Добавьте хотя бы одного получателя.');
  if(names.length>MAX_RECIPIENTS)throw Error(`Получателей: ${names.length}. В одном комплекте можно создать до ${MAX_RECIPIENTS} писем. Разделите список на несколько комплектов.`);
  const long=names.findIndex(n=>Array.from(n).length>200);
  if(long!==-1)throw Error(`Строка ${long+1}: имя длиннее 200 символов. Проверьте выбранные столбцы.`);
  return names;
}
export function duplicateCount(names){const seen=new Set();let n=0;for(const name of names){const key=cleanName(name).toLocaleLowerCase('ru');if(seen.has(key))n++;else seen.add(key);}return n;}

// Quoted delimiters, escaped quotes and embedded newlines are kept inside a cell.
export function parseDelimited(text,delimiter){
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  const addCell=()=>{row.push(cell);cell='';closed=false;if(row.length>MAX_COLS)throw Error('В таблице больше 128 столбцов. Оставьте только список получателей.');};
  const addRow=()=>{addCell();rows.push(row);row=[];if(rows.length>MAX_ROWS)throw Error('В файле больше 5000 строк. Оставьте только список получателей.');};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c===delimiter){addCell();continue;}
    if(c==='\n'){addRow();continue;}
    if(closed){if(/[ \t]/.test(c))continue;throw Error('Не удалось прочитать CSV: после закрывающей кавычки ожидается разделитель.');}
    if(c==='"'&&!cell){quoted=true;continue;}
    cell+=c;
  }
  if(quoted)throw Error('В CSV не закрыта кавычка. Сохраните список заново в Excel.');
  if(cell||row.length||closed)addRow();
  return rows;
}
export function csvRows(text){
  const sep=text.match(/^\uFEFF?sep=([;,\t])\r?\n/i);
  if(sep)return parseDelimited(text.slice(sep[0].length),sep[1]);
  let best=null,score=-1,lastError;
  for(const d of [';',',','\t'])try{
    const rows=parseDelimited(text,d),sample=rows.filter(r=>r.some(v=>v.trim())).slice(0,20),width=sample[0]?.length||1;
    const value=width>1?sample.filter(r=>r.length===width).length*10+Math.min(width,9):0;
    if(value>score){best=rows;score=value;}
  }catch(e){lastError=e;}
  if(!best)throw lastError;
  return best;
}
function decodeText(bytes){
  if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le').decode(bytes);
  if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be').decode(bytes);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('windows-1251').decode(bytes);}
}

// A bounded ZIP reader: central directory + CRC, stored/DEFLATE entries only.
// No workbook code, macros, formulas or external relationships are executed.
export async function readXlsxZip(buffer){
  if(buffer.byteLength>MAX_FILE)throw Error('Выберите файл размером до 5 МБ.');
  const bytes=new Uint8Array(buffer),v=new DataView(buffer),u16=n=>v.getUint16(n,true),u32=n=>v.getUint32(n,true),files=Object.create(null);
  const bad=()=>Error('Не удалось прочитать XLSX. Откройте файл в Excel и сохраните заново без пароля.');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
  if(end<0)throw bad();
  const count=u16(end+10),central=u32(end+16);let pos=central,total=0;
  if(u16(end+4)||u16(end+6)||count!==u16(end+8)||count>500||central+u32(end+12)!==end)throw bad();
  for(let i=0;i<count;i++){
    if(pos+46>end||u32(pos)!==0x02014b50)throw bad();
    const flags=u16(pos+8),method=u16(pos+10),packed=u32(pos+20),size=u32(pos+24),nl=u16(pos+28),extra=u16(pos+30),comment=u16(pos+32),local=u32(pos+42),next=pos+46+nl+extra+comment;
    if(next>end)throw bad();
    const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nl));
    if(!name||name.includes('..')||name.startsWith('/')||name.includes('\\')||Object.hasOwn(files,name)||(flags&1)||![0,8].includes(method))throw bad();
    total+=size;if(total>MAX_UNPACKED)throw Error('Содержимое Excel превышает 20 МБ. Оставьте в файле только список получателей.');
    if(local+30>central||u32(local)!==0x04034b50)throw bad();
    const start=local+30+u16(local+26)+u16(local+28);if(start+packed>central)throw bad();
    let data=bytes.slice(start,start+packed);
    if(method===8){
      let stream;try{stream=new DecompressionStream('deflate-raw');}catch{throw Error('Для чтения Excel обновите браузер или загрузите список в CSV.');}
      const reader=new Blob([data]).stream().pipeThrough(stream).getReader(),parts=[];let received=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;received+=value.length;if(received>size||received>MAX_UNPACKED){await reader.cancel();throw bad();}parts.push(value);}}finally{reader.releaseLock();}
      data=new Uint8Array(received);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}
    }
    if(data.length!==size||crc32(data)!==u32(pos+16))throw bad();
    files[name]=data;pos=next;
  }
  if(pos!==end||!files['xl/workbook.xml']||!files['[Content_Types].xml'])throw bad();
  return files;
}
function xml(bytes){
  if(!bytes)throw Error('В Excel отсутствует часть таблицы. Сохраните файл заново.');
  const s=new TextDecoder().decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('Неподдерживаемая структура XML в Excel.');
  const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('Повреждена структура Excel.');return d;
}
const nodes=(n,tag)=>[...n.getElementsByTagNameNS('*',tag)];
const textRuns=n=>nodes(n,'t').filter(t=>!t.closest('rPh')).map(t=>t.textContent).join('');
export function xlsxSheets(files){
  const wb=xml(files['xl/workbook.xml']),rels=xml(files['xl/_rels/workbook.xml.rels']);
  const relationships=nodes(rels,'Relationship');
  const targetPath=r=>{
    if(!r||r.getAttribute('TargetMode')==='External')throw Error('Внешние таблицы Excel не поддерживаются. Сохраните список в этом файле.');
    let path=r.getAttribute('Target');path=path.startsWith('/')?path.slice(1):'xl/'+path.replace(/^\.\//,'');
    if(path.includes('..')||path.includes('\\')||!path.startsWith('xl/'))throw Error('Неподдерживаемый путь листа Excel.');return path;
  };
  const sharedRel=relationships.find(r=>r.getAttribute('Type').endsWith('/sharedStrings'));
  const sharedPath=sharedRel?targetPath(sharedRel):'xl/sharedStrings.xml';
  const shared=files[sharedPath]?nodes(xml(files[sharedPath]),'si').map(textRuns):[];
  const sheets=[];
  for(const sheet of nodes(wb,'sheet')){
    const id=[...sheet.attributes].find(a=>a.localName==='id')?.value,r=relationships.find(r=>r.getAttribute('Id')===id);
    if(!r?.getAttribute('Type').endsWith('/worksheet'))continue;
    const doc=xml(files[targetPath(r)]),rows=[],formulas=[];
    for(const row of nodes(doc,'row')){
      const out=[];let next=0,rowHasFormula=false;
      for(const cell of nodes(row,'c')){
        const ref=cell.getAttribute('r'),match=ref.match(/^([A-Z]+)\d+$/),col=match?[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1:next;next=col+1;
        const type=cell.getAttribute('t'),value=nodes(cell,'v')[0]?.textContent||'';
        const formula=nodes(cell,'f').length>0;
        let text=type==='inlineStr'?textRuns(cell):type==='s'?shared[Number(value)]:type==='e'?'':value;
        if(type==='s'&&(!/^\d+$/.test(value)||text===undefined))throw Error('Поврежден словарь строк Excel.');
        if(!text&&!formula)continue;
        if(col>=MAX_COLS)throw Error('В таблице больше 128 столбцов. Оставьте только список получателей.');
        out[col]=text??'';
        if(formula){formulas.push([rows.length,col]);rowHasFormula=true;}
      }
      if(out.length||rowHasFormula){rows.push(Array.from(out,v=>v??''));if(rows.length>MAX_ROWS)throw Error('На листе больше 5000 строк. Оставьте только список получателей.');}
    }
    if(rows.length)sheets.push({name:sheet.getAttribute('name')||'Лист',rows,formulas,hidden:sheet.getAttribute('state')==='hidden'||sheet.getAttribute('state')==='veryHidden'});
  }
  if(!sheets.length)throw Error('В Excel нет заполненных листов.');return sheets;
}
export async function readRecipientFile(file){
  if(!file.size)throw Error('Файл пуст.');
  if(file.size>MAX_FILE)throw Error('Выберите файл размером до 5 МБ.');
  const ext=file.name.split('.').pop().toLowerCase(),buffer=await file.arrayBuffer();
  if(ext==='xlsx')return {sheets:xlsxSheets(await readXlsxZip(buffer))};
  if(!['csv','txt'].includes(ext))throw Error('Поддерживаются Excel (.xlsx), CSV и TXT. Старый XLS сохраните как XLSX.');
  const text=decodeText(new Uint8Array(buffer));
  if(text.includes('\0'))throw Error('Не удалось прочитать текстовый файл. Сохраните его в UTF-8.');
  const rows=ext==='csv'?csvRows(text):text.replace(/^\uFEFF/,'').split(/\r\n?|\n/).map(s=>[s]);
  if(rows.length>MAX_ROWS)throw Error('В файле больше 5000 строк. Оставьте только список получателей.');
  if(!rows.some(r=>r.some(v=>v.trim())))throw Error('В файле нет получателей.');
  return {sheets:[{name:file.name,rows,formulas:[]}]};
}
const headerKey=s=>cleanName(s).toLocaleLowerCase('ru').replace(/[.()]/g,'').replace(/\s+/g,' ');
export function suggestColumns(rows){
  const first=rows.findIndex(r=>r.some(v=>cleanName(v))),h=(rows[first]||[]).map(headerKey);
  const full=h.findIndex(v=>/^(фио|ф и о|фамилия имя отчество|полное имя|получатель|кому|фио в дательном падеже|фио дательный падеж)$/.test(v));
  const last=h.indexOf('фамилия'),given=h.indexOf('имя'),middle=h.indexOf('отчество');
  const split=last>=0&&given>=0;
  return {header:full>=0||split,start:first<0?0:first,mode:split&&full<0?'split':'full',full:full>=0?full:(Math.max(...rows.map(r=>r.length))===1?0:-1),last,given,middle};
}
export function recipientsFromSheet(sheet,options){
  const columns=options.mode==='split'?[options.last,options.given,options.middle].filter(n=>n>=0):[options.full];
  if(!columns.length||columns.includes(-1)||(options.mode==='split'&&(options.last<0||options.given<0)))throw Error('Выберите столбец с ФИО или столбцы с фамилией и именем.');
  if(new Set(columns).size!==columns.length)throw Error('Для фамилии, имени и отчества выберите разные столбцы.');
  const names=[];let blank=0,formulaCount=0,incomplete=0;
  const start=options.start+(options.header?1:0),formulas=new Set((sheet.formulas||[]).map(([r,c])=>r+':'+c));
  for(let i=start;i<sheet.rows.length;i++){
    const row=sheet.rows[i];let formula=false;
    for(const c of columns)if(formulas.has(i+':'+c)){formula=true;if(!cleanName(row[c]))throw Error(`Строка ${i+1}: у формулы нет сохраненного результата. В Excel замените формулы в ФИО значениями и загрузите файл снова.`);}
    const parts=columns.map(c=>cleanName(row[c])),name=parts.filter(Boolean).join(' ');
    if(!name){blank++;continue;}
    if(options.mode==='split'&&(!parts[0]||!parts[1]))incomplete++;
    if(formula)formulaCount++;
    names.push(name);
  }
  return {names,blank,formulaCount,incomplete};
}
