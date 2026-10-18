import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {zip,crc32} from '../docs/docgen.js';
import {parseDelimited,csvRows,suggestColumns,recipientsFromSheet,nameLines,duplicateCount,checkNames,readRecipientFile,readXlsxZip} from '../docs/letter-recipients.js';

test('CSV preserves quoted separators, escaped quotes and multiline cells; detects Excel separators',()=>{
  const text='\uFEFFФИО;Комментарий\r\n"Иванову Ивану";"Спасибо; за помощь"\r\n"Петровой Анне";"строка 1\nстрока ""2"""\r\n';
  assert.deepEqual(csvRows(text),[['ФИО','Комментарий'],['Иванову Ивану','Спасибо; за помощь'],['Петровой Анне','строка 1\nстрока "2"']]);
  assert.deepEqual(csvRows('sep=,\nФИО,Проект\nИванову Ивану,МАНТ'),[['ФИО','Проект'],['Иванову Ивану','МАНТ']]);
  assert.deepEqual(csvRows('ФИО\tПроект\nИванову Ивану\tМАНТ'),[['ФИО','Проект'],['Иванову Ивану','МАНТ']]);
  assert.throws(()=>parseDelimited('ФИО;Проект\n"не закрыта',';'),/кавычка/);
  assert.throws(()=>parseDelimited('"Имя"лишнее;1',';'),/разделитель/);
});
test('column suggestions require known headers; no-header first recipient is retained',()=>{
  const rows=[['Иванову Ивану'],['Петровой Анне']];
  const options=suggestColumns(rows);assert.equal(options.header,false);
  assert.deepEqual(recipientsFromSheet({rows},options).names,rows.flat());
  const unknown=[['№','Участник проекта','Телефон'],['1','Иванову Ивану','123']];
  assert.equal(suggestColumns(unknown).full,-1);
  assert.throws(()=>recipientsFromSheet({rows:unknown},suggestColumns(unknown)),/Выберите столбец/);
});
test('split columns follow surname-name-patronymic order, allow absent patronymics and preserve namesakes',()=>{
  const rows=[[],['Отчество','Имя','Фамилия','Город'],['Ивановичу','Ивану','Иванову','Казань'],['','Анне','Петровой','Казань'],['','','','Казань'],['','Анне','Петровой','Москва']];
  const result=recipientsFromSheet({rows},suggestColumns(rows));
  assert.deepEqual(result.names,['Иванову Ивану Ивановичу','Петровой Анне','Петровой Анне']);
  assert.equal(result.blank,1);assert.equal(duplicateCount(result.names),1);
  assert.equal(result.incomplete,0);
  assert.throws(()=>recipientsFromSheet({rows},{...suggestColumns(rows),given:2}),/разные столбцы/);
});
test('formula results are never evaluated and absent caches are not silently dropped',()=>{
  const sheet={rows:[['ФИО'],['Иванову Ивану']],formulas:[[1,0]]};
  assert.equal(recipientsFromSheet(sheet,suggestColumns(sheet.rows)).formulaCount,1);
  sheet.rows[1]=[''];assert.throws(()=>recipientsFromSheet(sheet,suggestColumns(sheet.rows)),/сохраненного результата/);
});
test('whole list limits and names are checked without truncation or automatic declension',()=>{
  assert.deepEqual(nameLines(' Иванов  Иван\n\nПетровой\tАнне '),['Иванов Иван','Петровой Анне']);
  assert.equal(checkNames(Array(200).fill('Получатель')).length,200);
  assert.throws(()=>checkNames(Array(201).fill('Получатель')),/201/);
  assert.throws(()=>checkNames(['а'.repeat(201)]),/Строка 1/);
  assert.throws(()=>checkNames([]),/Добавьте/);
});
test('text import supports UTF-8 BOM, Windows-1251 and UTF-16 without uploading source data',async()=>{
  const file=(name,bytes)=>({name,size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  const cp=Uint8Array.from([0xc8,0xe2,0xe0,0xed,0xee,0xe2,0xf3]);
  assert.deepEqual((await readRecipientFile(file('list.txt',cp))).sheets[0].rows,[['Иванову']]);
  const utf16=Buffer.from('\uFEFFИванову\r\nПетровой','utf16le');
  assert.deepEqual((await readRecipientFile(file('list.txt',utf16))).sheets[0].rows,[['Иванову'],['Петровой']]);
  await assert.rejects(readRecipientFile(file('list.xls',cp)),/XLSX/);
  await assert.rejects(readRecipientFile({name:'list.csv',size:6*1024*1024}),/5 МБ/);
});
async function archive(entries,compress=false){
  if(!compress)return zip(entries).arrayBuffer();
  const locals=[],central=[];let offset=0;
  for(const [name,bytes] of Object.entries(entries)){
    const n=Buffer.from(name),raw=Buffer.from(bytes),data=deflateRawSync(raw),l=Buffer.alloc(30),c=Buffer.alloc(46),crc=crc32(raw);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(raw.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    locals.push(l,n,data);central.push(c,n);offset+=l.length+n.length+data.length;
  }
  const cd=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(Object.keys(entries).length,8);e.writeUInt16LE(Object.keys(entries).length,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);
  const all=Buffer.concat([...locals,cd,e]);return all.buffer.slice(all.byteOffset,all.byteOffset+all.byteLength);
}
test('XLSX ZIP validates stored and DEFLATE entries, corruption, size and traversal',async()=>{
  const entries={'[Content_Types].xml':Buffer.from('<Types/>'),'xl/workbook.xml':Buffer.from('<workbook/>')};
  for(const compressed of [false,true]){
    const data=await archive(entries,compressed),files=await readXlsxZip(data);
    assert.equal(new TextDecoder().decode(files['xl/workbook.xml']),'<workbook/>');
    const broken=new Uint8Array(data.slice(0));broken[14]^=1; // central CRC is authoritative; corrupt entry instead
    broken[30+'[Content_Types].xml'.length]^=0x40;
    await assert.rejects(readXlsxZip(broken.buffer));
  }
  await assert.rejects(readXlsxZip(await archive({...entries,'../escape':Buffer.from('x')})),/прочитать/);
  await assert.rejects(readXlsxZip(await archive({...entries,'big.xml':new Uint8Array(21*1024*1024)},true)),/20 МБ/);
  await assert.rejects(readXlsxZip(new ArrayBuffer(3)),/прочитать/);
});
