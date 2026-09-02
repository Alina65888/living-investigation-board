import {cpSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const source=resolve(root,'docs');
const output=resolve(root,'dist');
const required=['index.html','app-v4.js','board-v8.js','hq.js','style.css'];

for(const file of required){
  if(!existsSync(resolve(source,file)))throw new Error(`Не найден обязательный файл docs/${file}`);
}

const html=readFileSync(resolve(source,'index.html'),'utf8');
for(const marker of ['id="app"','app-v4.js','board-v8.js']){
  if(!html.includes(marker))throw new Error(`В docs/index.html отсутствует ${marker}`);
}

rmSync(output,{recursive:true,force:true});
mkdirSync(output,{recursive:true});
cpSync(source,output,{recursive:true});
console.log(`Статическая сборка готова: ${output}`);
