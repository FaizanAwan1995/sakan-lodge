import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
test('public maps config publishes only the dedicated browser key and never server secrets',async()=>{
 const key='AIza'+'x'.repeat(35),env={GOOGLE_MAPS_BROWSER_KEY:key,SUPABASE_SECRET_KEY:'private-server-secret',GMAIL_CLIENT_SECRET:'private-gmail-secret'};
 const response=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config'),env);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{key});assert.equal(response.headers.get('cache-control'),'no-store');
 const missing=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config'),{});assert.deepEqual(await missing.json(),{key:null});
 const invalid=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config'),{GOOGLE_MAPS_BROWSER_KEY:'private-server-secret'});assert.deepEqual(await invalid.json(),{key:null});
 const post=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config',{method:'POST'}),env);assert.equal(post.status,405);
});
