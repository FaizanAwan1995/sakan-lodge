import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {encryptBackup,decryptBackup} from '../scripts/backup-crypto.mjs';
test('encrypted backup restores synthetic SQL and rejects tampering without exposing partial plaintext',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'sakan-backup-test-'));
 try{
  const source=path.join(folder,'test.sql'),encrypted=source+'.enc',restored=path.join(folder,'restored.sql');
  const text='-- SYNTHETIC DATA ONLY\nSELECT 1;\n';const passphrase='test-only-random-passphrase-at-least-32-characters';
  await fs.writeFile(source,text);await encryptBackup(source,encrypted,passphrase);
  assert.ok(!(await fs.readFile(encrypted)).includes(Buffer.from(text)));
  await decryptBackup(encrypted,restored,passphrase);assert.equal(await fs.readFile(restored,'utf8'),text);
  await assert.rejects(()=>decryptBackup(encrypted,restored,passphrase),{code:'EEXIST'});
  const corrupt=await fs.readFile(encrypted);corrupt[40]^=1;await fs.writeFile(encrypted,corrupt);
  const target=path.join(folder,'tampered.sql');await assert.rejects(()=>decryptBackup(encrypted,target,passphrase));
  await assert.rejects(()=>fs.stat(target),{code:'ENOENT'});assert.ok(!(await fs.readdir(folder)).some(n=>n.includes('.partial-')));
 }finally{await fs.rm(folder,{recursive:true,force:true});}
});
