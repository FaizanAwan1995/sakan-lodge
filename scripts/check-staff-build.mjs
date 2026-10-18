import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const files=(await readdir('dist/assets')).filter(name=>name.endsWith('.js'));
const source=(await Promise.all(files.map(name=>readFile('dist/assets/'+name,'utf8')))).join('\n');
for(const required of ['Generate agreement draft','Fresh signatures','/api/gmail/preview'])assert.ok(source.includes(required),'Configured staff bundle is missing '+required);
console.log('Configured staff bundle includes agreement generation, signing and reviewed email workflows.');
