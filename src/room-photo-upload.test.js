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
