import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
const MAGIC=Buffer.from('SAKANBK1'),HEADER_SIZE=36,TAG_SIZE=16;
function derive(passphrase,salt){if(typeof passphrase!=='string'||passphrase.length<32)throw new Error('Set a separate backup encryption passphrase of at least 32 characters.');return scryptSync(passphrase,salt,32,{N:131072,r:8,p:1,maxmem:256*1024*1024});}
async function finish(temp,output){await fs.link(temp,output);await fs.unlink(temp);}
export async function encryptBackup(input,output,passphrase){
 const salt=randomBytes(16),iv=randomBytes(12),header=Buffer.concat([MAGIC,salt,iv]);
 const cipher=createCipheriv('aes-256-gcm',derive(passphrase,salt),iv);cipher.setAAD(header);
 const temp=output+'.partial-'+randomUUID();
 try{
  await fs.writeFile(temp,header,{flag:'wx',mode:0o600});
  await pipeline(createReadStream(input),cipher,createWriteStream(temp,{flags:'a',mode:0o600}));
  await fs.appendFile(temp,cipher.getAuthTag());await finish(temp,output);
 }catch(error){await fs.rm(temp,{force:true});throw error;}
}
export async function decryptBackup(input,output,passphrase){
 const file=await fs.open(input,'r');let header,tag,size;
 try{size=(await file.stat()).size;if(size<HEADER_SIZE+TAG_SIZE)throw new Error('Invalid backup');header=Buffer.alloc(HEADER_SIZE);tag=Buffer.alloc(TAG_SIZE);await file.read(header,0,HEADER_SIZE,0);await file.read(tag,0,TAG_SIZE,size-TAG_SIZE);}finally{await file.close();}
 if(!header.subarray(0,8).equals(MAGIC))throw new Error('Unsupported backup format');
 const decipher=createDecipheriv('aes-256-gcm',derive(passphrase,header.subarray(8,24)),header.subarray(24,36));decipher.setAAD(header);decipher.setAuthTag(tag);
 const temp=output+'.partial-'+randomUUID();
 try{
  await pipeline(createReadStream(input,{start:HEADER_SIZE,end:size-TAG_SIZE-1}),decipher,createWriteStream(temp,{flags:'wx',mode:0o600}));
  await finish(temp,output);
 }catch(error){await fs.rm(temp,{force:true});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,input,output]=process.argv.slice(2);
 try{
  if(!input||!output||!['encrypt','decrypt'].includes(action))throw new Error('Usage: backup-crypto.mjs encrypt|decrypt input output');
  const operation=action==='encrypt'?encryptBackup:decryptBackup;
  await operation(input,output,process.env.BACKUP_ENCRYPTION_PASSPHRASE);
  if(action==='encrypt'){
   const hash=createHash('sha256');for await(const chunk of createReadStream(output))hash.update(chunk);
   await fs.writeFile(output+'.sha256',hash.digest('hex')+'  '+output+'\n',{flag:'wx',mode:0o600});
  }
 }catch(error){console.error('Backup operation failed:',error.code||error.message);process.exitCode=1;}
}
