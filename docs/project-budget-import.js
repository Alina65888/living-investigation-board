// Import values from Word tables locally. A preview is required before persistence.
import {BUDGET_FORMATS} from './project-budget.js?v=61';
import {readWordZip} from './template-editor.js?v=61';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9]/g,'');
const sectionKey=s=>norm(String(s||'').replace(/^\s*\d+[.)\s]+/,''));
export function budgetNumber(value){
 const s=String(value??'').trim().replace(/(?:руб(?:лей|ля|ль)?\.?|₽)\s*$/i,'').replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
 return /^\d+(?:\.\d+)?$/.test(s)&&Number.isFinite(+s)?+s:null;
}
function columns(cells){
 const map={};
 cells.forEach((s,i)=>{const n=norm(s);
  if(/наименован|статьярасход|название/.test(n))map.name=i;
  else if(/описание|характеристик|обоснован/.test(n))map.description=i;
  else if(/единиц|едизм/.test(n))map.unit=i;
  else if(/количеств|колво/.test(n))map.qty=i;
  else if(/цена|стоимость.*ед|стоимостьед/.test(n))map.price=i;
  else if(/сумма|всего|общаястоимость/.test(n))map.total=i;
 });
 return ['name','unit','qty','price'].every(k=>map[k]!==undefined)?map:null;
}
export function parseBudgetTables(tables,fallback='competition'){
 const scores=Object.fromEntries(Object.keys(BUDGET_FORMATS).map(k=>[k,0]));
 for(const rows of tables)for(const cells of rows)for(const cell of cells)for(const [key,format] of Object.entries(BUDGET_FORMATS))if(format.sections.some(s=>sectionKey(s)===sectionKey(cell)))scores[key]++;
 const best=Object.keys(scores).sort((a,b)=>scores[b]-scores[a])[0];
 const format=scores[best]>0?best:fallback,sections=BUDGET_FORMATS[format].sections,items=[],warnings=[],sourceTotals=[];
 let matchedTables=0;
 for(const [tableIndex,rows] of tables.entries()){
  let map=null,sourceSection='';
  for(const [rowIndex,cells] of rows.entries()){
   const header=columns(cells);if(header){map=header;matchedTables++;continue;}
   if(!map)continue;
   const nonempty=cells.map(s=>s.trim()).filter(Boolean),text=nonempty.join(' ');
   if(!text)continue;
   // Printed column numbers are not positions (common on continued pages).
   if(nonempty.length>=4&&nonempty.every((s,i)=>s===String(i+1)))continue;
   const label=nonempty.find(s=>/[а-яa-z]/i.test(s))||'';
   if(/^(?:общий\s+)?(?:итого?|всего)(?:[\s:—-]|$)/i.test(label)){if(/^общий/i.test(label)){const total=budgetNumber(nonempty.at(-1));if(total!==null)sourceTotals.push(total);}continue;}
   const section=nonempty.find(s=>sections.some(title=>sectionKey(title)===sectionKey(s)));
   if(section){sourceSection=section;continue;}
   const qty=budgetNumber(cells[map.qty]),price=budgetNumber(cells[map.price]);
   // Merged section headings contain no item quantities/prices. Keep the
   // original title so unfamiliar sections require an explicit mapping.
   if(nonempty.length<=2&&label&&qty===null&&price===null){sourceSection=label;continue;}
   const nameCell=String(cells[map.name]||'').trim();
   if(/^[—–-]$/.test(nameCell)&&[map.unit,map.qty,map.price,map.total].every(k=>!String(cells[k]||'').trim()))continue;
   if(!nameCell){warnings.push(`Таблица ${tableIndex+1}, строка ${rowIndex+1}: строка без наименования пропущена (${text.slice(0,120)}).`);continue;}
   const lines=nameCell.split('\n').map(s=>s.trim()).filter(Boolean);
   const item={section:sections.findIndex(s=>sectionKey(s)===sectionKey(sourceSection)),sourceSection,name:lines[0],description:[...lines.slice(1),cells[map.description]||''].filter(Boolean).join('\n'),unit:String(cells[map.unit]||'').trim(),qty,price};
   const total=budgetNumber(cells[map.total]);
   if(total!==null&&qty!==null&&price!==null&&Math.abs(Math.round(qty*price*100)/100-total)>.009)item.sourceConflict={price,total,resolved:false};
   items.push(item);
   if(items.length>500)throw new Error('В одной загрузке может быть до 500 позиций. Разделите смету на несколько файлов.');
  }
 }
 if(!matchedTables||!items.length)throw new Error('Не найдена таблица сметы. Нужны столбцы «Наименование», «Единица измерения», «Количество» и «Цена» (или «Стоимость за единицу»). Изображения таблиц не распознаются.');
 if(items.some(i=>i.qty===null||i.price===null))warnings.push('Некоторые количества или цены не распознаны. После добавления заполните пустые ячейки.');
 if(items.some(i=>i.sourceConflict))warnings.push('В документе есть расхождение цены и суммы. После добавления подтвердите верную цену в таблице.');
 const calculated=items.reduce((sum,i)=>sum+Math.round((i.qty||0)*(i.price||0)*100),0)/100;
 if(sourceTotals.length===1&&Math.abs(calculated-sourceTotals[0])>.009)warnings.push(`Общий итог в Word: ${sourceTotals[0].toLocaleString('ru-RU')} ₽; по распознанным ценам: ${calculated.toLocaleString('ru-RU')} ₽. Проверьте суммы и полноту строк.`);
 return {format,items,warnings};
}
export async function importBudgetDocx(file,fallback){
 if(!/\.docx$/i.test(file.name))throw new Error('Выберите файл .docx. Старый .doc сначала сохраните в Word как DOCX.');
 if(file.size>2*1024*1024)throw new Error('Выберите DOCX размером до 2 МБ. Удалите из него лишние изображения.');
 const files=await readWordZip(await file.arrayBuffer()),xml=new TextDecoder().decode(files['word/document.xml']);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Неподдерживаемая структура Word.');
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.querySelector('parsererror'))throw new Error('Не удалось прочитать Word. Сохраните документ заново в формате DOCX.');
 if(['ins','del','moveFrom','moveTo'].some(tag=>doc.getElementsByTagNameNS(W,tag).length))throw new Error('Примите или отклоните исправления в Word перед загрузкой сметы.');
 const direct=(node,tag)=>[...node.children].filter(c=>c.namespaceURI===W&&c.localName===tag);
 const tables=[...doc.getElementsByTagNameNS(W,'tbl')].map(table=>direct(table,'tr').map(row=>{
  const cells=[];
  for(const cell of direct(row,'tc')){
   const text=direct(cell,'p').map(p=>[...p.getElementsByTagNameNS(W,'r')].map(r=>[...r.children].map(n=>n.localName==='t'?n.textContent:['br','cr'].includes(n.localName)?'\n':n.localName==='tab'?' ':'').join('')).join('')).join('\n').trim();
   const span=Number(cell.getElementsByTagNameNS(W,'gridSpan')[0]?.getAttributeNS(W,'val')||1);
   if(!Number.isInteger(span)||span<1||span>30)throw new Error('Не удалось прочитать объединенные ячейки таблицы.');
   cells.push(text,...Array(span-1).fill(''));
  }
  return cells;
 }));
 return parseBudgetTables(tables,fallback);
}
