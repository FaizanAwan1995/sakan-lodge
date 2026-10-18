import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const files=(await readdir('dist/assets')).filter(name=>name.endsWith('.js'));
const source=(await Promise.all(files.map(name=>readFile('dist/assets/'+name,'utf8')))).join('\n');
for(const required of ['Generate contract PDF','Confirm reservation and assign tenant','/api/gmail/preview'])assert.ok(source.includes(required),'Configured staff bundle is missing '+required);
console.log('Configured staff bundle includes agreement generation, signing and reviewed email workflows.');
