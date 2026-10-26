import test from 'node:test';import assert from 'node:assert/strict';import {roomPhotoFileError} from './room-photo-upload.js';
test('room photo upload accepts supported photos and rejects empty, oversized and active formats',()=>{
 for(const type of ['image/jpeg','image/png','image/webp'])assert.equal(roomPhotoFileError({type,size:1000000}),'');
 for(const f of [{type:'image/svg+xml',size:200},{type:'image/heic',size:200},{type:'image/jpeg',size:0},{type:'image/jpeg',size:21*1024*1024}])assert.ok(roomPhotoFileError(f));
});
