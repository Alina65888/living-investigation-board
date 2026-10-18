// Synthetic spreadsheet: sparse cells, shared/rich strings, names in separate
// columns, multiple sheets and a formula with no cached result.
import {zip} from '../docs/docgen.js';
export const batchNames=Array.from({length:200},(_,i)=>`Получателю Тестовому ${String(i+1).padStart(3,'0')}`);
export async function recipientWorkbook(){
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const cell=(r,t)=>`<c r="${r}" t="inlineStr"><is><t>${t}</t></is></c>`;
 const sheet=rows=>`<worksheet xmlns="${ns}"><sheetData>${rows}</sheetData></worksheet>`;
 const entries={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Имена" sheetId="1" r:id="r1"/><sheet name="Все участники" sheetId="2" r:id="r2"/><sheet name="Без результата" sheetId="3" r:id="r3"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1,2,3].map(i=>`<Relationship Id="r${i}" Type="${rel}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="s" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  'xl/sharedStrings.xml':`<sst xmlns="${ns}"><si><t>Фамилия</t></si><si><r><t>Ива</t></r><r><t>нову</t></r></si></sst>`,
  'xl/worksheets/sheet1.xml':sheet(`<row r="1">${cell('A1','№')}<c r="C1" t="s"><v>0</v></c>${cell('D1','Имя')}${cell('E1','Отчество')}</row><row r="2">${cell('A2','1')}<c r="C2" t="s"><v>1</v></c>${cell('D2','Ивану')}${cell('E2','Ивановичу')}</row><row r="3">${cell('A3','2')}${cell('C3','Петровой')}${cell('D3','Анне')}</row><row r="4">${cell('A4','3')}</row><row r="5">${cell('C5','Петровой')}${cell('D5','Анне')}</row>`),
  'xl/worksheets/sheet2.xml':sheet(`<row r="1">${cell('B1','ФИО')}</row>`+batchNames.map((n,i)=>`<row r="${i+2}">${cell('B'+(i+2),n)}</row>`).join('')),
  'xl/worksheets/sheet3.xml':sheet(`<row r="1">${cell('A1','ФИО')}</row><row r="2"><c r="A2" t="str"><f>CONCAT(B2,C2)</f></c>${cell('B2','Иванову')}${cell('C2','Ивану')}</row>`)
 };
 return Buffer.from(await zip(Object.fromEntries(Object.entries(entries).map(([name,value])=>[name,new TextEncoder().encode(value)]))).arrayBuffer());
}
