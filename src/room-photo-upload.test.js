import test from 'node:test';import assert from 'node:assert/strict';import {roomPhotoFileError} from './room-photo-upload.js';
test('room photo upload accepts supported photos and rejects empty, oversized and active formats',()=>{
 for(const type of ['image/jpeg','image/png','image/webp','image/heic','image/heif'])assert.equal(roomPhotoFileError({type,size:1000000}),'');
 for(const f of [{type:'image/svg+xml',size:200},{type:'image/jpeg',size:0},{type:'image/jpeg',size:21*1024*1024}])assert.ok(roomPhotoFileError(f));
});

test('iPhone files without MIME types are validated by supported extension',()=>{assert.equal(roomPhotoFileError({name:'IMG_1234.HEIC',type:'',size:200}),'');assert.ok(roomPhotoFileError({name:'script.svg',type:'',size:200}));});
test('iPhone photos use native image decoding and are resized into JPEG with cleanup',async()=>{
 const {prepareRoomPhoto}=await import('./room-photo-upload.js');const originalImage=globalThis.Image,originalDocument=globalThis.document;let canvas,failed=false;
 globalThis.Image=class{naturalWidth=4000;naturalHeight=3000;set src(value){if(value)queueMicrotask(()=>failed?this.onerror?.():this.onload?.());}};
 globalThis.document={createElement:()=>canvas={getContext:()=>({fillRect(){},drawImage(){}}),toBlob:cb=>cb(new Blob(['jpeg'],{type:'image/jpeg'}))}};
 try{const output=await prepareRoomPhoto(new Blob(['heic'],{type:'image/heic'}));assert.equal(output.type,'image/jpeg');assert.equal(canvas.width,1600);assert.equal(canvas.height,1200);failed=true;await assert.rejects(()=>prepareRoomPhoto(new Blob(['bad'],{type:'image/heic'})),/could not read/);}finally{globalThis.Image=originalImage;globalThis.document=originalDocument;}
});

test('batch upload saves every selected photo with the latest gallery revision and preserves existing photos',async()=>{
 const {uploadRoomPhotoBatch}=await import('./room-photo-upload.js');let uploads=0;const revisions=[];
 const r=await uploadRoomPhotoBatch({items:[{file:{name:'a.jpg'}},{file:{name:'b.jpg'}},{file:{name:'c.jpg'}}],profile:{photos:['existing'],revision:2},prepare:async()=>new Blob(['jpeg']),upload:async()=>`url-${++uploads}`,save:async(photos,revision)=>{revisions.push(revision);return {photos,revision:revision+1};}});
 assert.deepEqual(r.profile.photos,['existing','url-1','url-2','url-3']);assert.deepEqual(revisions,[2,3,4]);assert.ok(r.items.every(i=>i.state==='saved'));assert.equal(r.needsReload,false);
});
test('one unreadable photo does not discard the others and retry only uploads the failed file',async()=>{
 const {uploadRoomPhotoBatch}=await import('./room-photo-upload.js');let fail=true,uploads=0;
 const deps={prepare:async f=>{if(f.name==='bad.heic'&&fail)throw Error('Could not decode');return new Blob(['jpeg']);},upload:async()=>`url-${++uploads}`,save:async(photos,revision)=>({photos,revision:(revision??0)+1})};
 const first=await uploadRoomPhotoBatch({...deps,items:[{file:{name:'a.jpg'}},{file:{name:'bad.heic'}},{file:{name:'c.jpg'}}],profile:null});
 assert.deepEqual(first.items.map(i=>i.state),['saved','failed','saved']);assert.equal(uploads,2);
 fail=false;const retry=await uploadRoomPhotoBatch({...deps,items:first.items,profile:first.profile});assert.equal(uploads,3);assert.equal(retry.profile.photos.length,3);assert.ok(retry.items.every(i=>i.state==='saved'));
});
test('uncertain or stale gallery saves stop the batch and reuse the uploaded URL after reloading',async()=>{
 const {uploadRoomPhotoBatch}=await import('./room-photo-upload.js');let uploads=0;
 const first=await uploadRoomPhotoBatch({items:[{file:{name:'a'}},{file:{name:'b'}}],profile:null,prepare:async()=>new Blob(['jpeg']),upload:async()=>`url-${++uploads}`,save:async()=>{throw Error('Response lost');}});
 assert.equal(first.needsReload,true);assert.equal(first.items[0].url,'url-1');assert.equal(first.items[1].state,'queued');
 const retry=await uploadRoomPhotoBatch({items:first.items,profile:{photos:['other-admin','url-1'],revision:4},prepare:async()=>new Blob(['jpeg']),upload:async()=>`url-${++uploads}`,save:async(photos,revision)=>({photos,revision:revision+1})});
 assert.equal(uploads,2);assert.deepEqual(retry.profile.photos,['other-admin','url-1','url-2']);
});
test('gallery save rejected before commit retries the same upload without another storage write',async()=>{
 const {uploadRoomPhotoBatch}=await import('./room-photo-upload.js');let uploads=0;
 const deps={prepare:async()=>new Blob(['jpeg']),upload:async()=>`url-${++uploads}`};
 const first=await uploadRoomPhotoBatch({...deps,items:[{file:{name:'a'}}],profile:{photos:[],revision:1},save:async()=>{throw Error('Changed');}});
 const retry=await uploadRoomPhotoBatch({...deps,items:first.items,profile:{photos:['new-main'],revision:2},save:async(photos,revision)=>({photos,revision:revision+1})});assert.equal(uploads,1);assert.deepEqual(retry.profile.photos,['new-main','url-1']);
});
test('batch cannot upload beyond remaining gallery capacity',async()=>{
 const {uploadRoomPhotoBatch}=await import('./room-photo-upload.js');let uploads=0;
 const r=await uploadRoomPhotoBatch({items:[{file:{name:'a'}},{file:{name:'b'}}],profile:{photos:Array.from({length:19},(_,i)=>`old-${i}`),revision:1},prepare:async()=>new Blob(['jpeg']),upload:async()=>`url-${++uploads}`,save:async(photos,revision)=>({photos,revision:revision+1})});assert.equal(uploads,1);assert.equal(r.profile.photos.length,20);assert.equal(r.items[1].state,'failed');
});

test('a storage failure does not stop other files in the batch',async()=>{
 const {uploadRoomPhotoBatch}=await import('./room-photo-upload.js');let calls=0;
 const result=await uploadRoomPhotoBatch({items:[{file:{name:'a'}},{file:{name:'b'}},{file:{name:'c'}}],profile:null,prepare:async()=>new Blob(['jpeg']),upload:async()=>{if(++calls===2)throw Error('Storage unavailable');return `url-${calls}`;},save:async(photos,revision)=>({photos,revision:(revision??0)+1})});
 assert.deepEqual(result.items.map(i=>i.state),['saved','failed','saved']);assert.deepEqual(result.profile.photos,['url-1','url-3']);
});
