// BIFF8 template filling, not a conversion: fonts, XFs, rows, columns, merges,
// borders and print records are copied verbatim from the supplied Excel forms.
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const join=parts=>{const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let p=0;for(const b of parts){out.set(b,p);p+=b.length;}return out;};
const record=(tag,b)=>{const out=new Uint8Array(b.length+4),v=view(out);v.setUint16(0,tag,true);v.setUint16(2,b.length,true);out.set(b,4);return out;};
const unicode=s=>{const b=new Uint8Array(3+s.length*2),v=view(b);v.setUint16(0,s.length,true);b[2]=1;for(let i=0;i<s.length;i++)v.setUint16(3+i*2,s.charCodeAt(i),true);return b;};
const address=(r,c)=>{let s='';for(c++;c;c=Math.floor((c-1)/26))s=String.fromCharCode(65+(c-1)%26)+s;return s+(r+1);};
function stringTable(strings,count){
 const head=new Uint8Array(8);view(head).setUint32(0,count,true);view(head).setUint32(4,strings.length,true);
 const out=[];let parts=[head],length=8,tag=0xfc;
 for(const s of strings){const b=unicode(s);if(b.length>8000)throw Error('Слишком длинное поле платежного поручения.');if(length+b.length>8224){out.push(record(tag,join(parts)));parts=[];length=0;tag=0x3c;}parts.push(b);length+=b.length;}
 out.push(record(tag,join(parts)));return join(out);
}
export function paymentWorkbook(template,values){
 if(template.format!=='payment-biff8-v1')throw Error('Неподдерживаемый шаблон платежного поручения.');
 const strings=[...template.strings],found=new Set();let count=0;
 const rows=template.records.map(([tag,data])=>({tag,data:bytes(data)}));
 for(const row of rows){
  if(![0xfd,0x201].includes(row.tag))continue;
  const v=view(row.data),addr=address(v.getUint16(0,true),v.getUint16(2,true));
  if(Object.hasOwn(values,addr)){
   const data=new Uint8Array(10);data.set(row.data.subarray(0,6));view(data).setUint32(6,strings.length,true);strings.push(String(values[addr]??''));row.tag=0xfd;row.data=data;found.add(addr);
  }
  if(row.tag===0xfd)count++;
 }
 if(Object.keys(values).some(a=>!found.has(a)))throw Error('В шаблоне ПП отсутствуют поля для заполнения.');
 // Rebuild the SST using only referenced values, so template markers and old data
 // cannot remain hidden in the download. Row indexes are optional and rebuilt by Excel.
 const used=[],indices=new Map();for(const row of rows)if(row.tag===0xfd){const v=view(row.data),old=v.getUint32(6,true);if(!indices.has(old)){indices.set(old,used.length);used.push(strings[old]);}v.setUint32(6,indices.get(old),true);}
 let offset=0,sheetStart=0;const parts=[];let bounds;
 for(const row of rows){
  if([0x20b,0xd7].includes(row.tag))continue; // INDEX / DBCELL: stale optional byte offsets.
  if(row.tag===0x809&&view(row.data).getUint16(2,true)===0x10)sheetStart=offset;
  const b=row.tag===0xfc?stringTable(used,count):record(row.tag,row.data);
  if(row.tag===0x85)bounds=b;
  parts.push(b);offset+=b.length;
 }
 if(!bounds||!sheetStart)throw Error('Повреждена структура шаблона ПП.');
 view(bounds).setUint32(4,sheetStart,true);return join(parts);
}
// Minimal standard CFB v3 container with a single Workbook stream. No macros,
// original author metadata, cached example payees or external data are included.
export function compoundWorkbook(workbook){
 const END=0xfffffffe,FREE=0xffffffff,FAT=0xfffffffd,n=Math.ceil(workbook.length/512);
 if(workbook.length<4096||n+2>128)throw Error('Неподдерживаемый размер шаблона ПП.');
 const out=new Uint8Array((n+3)*512),h=view(out);out.set([208,207,17,224,161,177,26,225]);h.setUint16(24,0x3e,true);h.setUint16(26,3,true);h.setUint16(28,0xfffe,true);h.setUint16(30,9,true);h.setUint16(32,6,true);h.setUint32(44,1,true);h.setUint32(48,n,true);h.setUint32(56,4096,true);h.setUint32(60,END,true);h.setUint32(68,END,true);
 for(let i=0;i<109;i++)h.setUint32(76+i*4,i===0?n+1:FREE,true);
 out.set(workbook,512);const dir=(n+1)*512;
 function entry(at,name,type,start,size,child=FREE){for(let i=0;i<name.length;i++)h.setUint16(at+i*2,name.charCodeAt(i),true);h.setUint16(at+64,(name.length+1)*2,true);out[at+66]=type;out[at+67]=1;for(const k of [68,72])h.setUint32(at+k,FREE,true);h.setUint32(at+76,child,true);h.setUint32(at+116,start,true);h.setUint32(at+120,size,true);}
 entry(dir,'Root Entry',5,END,0,1);entry(dir+128,'Workbook',2,0,workbook.length);
 const fat=(n+2)*512;for(let i=0;i<128;i++)h.setUint32(fat+i*4,i<n-1?i+1:i===n-1||i===n?END:i===n+1?FAT:FREE,true);
 return out;
}
export const fillPaymentXls=(template,values)=>new Blob([compoundWorkbook(paymentWorkbook(template,values))],{type:'application/vnd.ms-excel'});
