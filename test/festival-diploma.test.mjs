import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const html=readFileSync(new URL('../server/public/api/diploma-assets/festival.html',import.meta.url),'utf8');
test('Festival source: all 24 filled records and embedded artwork/fonts are preserved exactly',()=>{
 const json=html.match(/<script id="initial" type="application\/json">([\s\S]*?)<\/script>/)[1];
 assert.equal(JSON.parse(json).records.length,24);
 assert.equal(createHash('sha256').update(json).digest('hex'),'b54dd2fcacc948d8ab7eb1b6eb6da37976be5959a2068c24537da2f1a9abdf8d');
 const assets=html.match(/data:(?:font|image)\/[^"\s)]+/g);
 assert.equal(assets.length,8);assert.equal(createHash('sha256').update(assets.join('\n')).digest('hex'),'354c7330e8d18e9c36ff1791bed89f6ed3f7397d37b380358720221fd580c7af');
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
});
