import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
test('public maps config publishes only the dedicated browser key and never server secrets',async()=>{
 const key='AIza'+'x'.repeat(35),env={GOOGLE_MAPS_BROWSER_KEY:key,SUPABASE_SECRET_KEY:'private-server-secret',GMAIL_CLIENT_SECRET:'private-gmail-secret'};
 const response=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config'),env);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{key,properties:{}});assert.equal(response.headers.get('cache-control'),'no-store');
 const missing=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config'),{});assert.deepEqual(await missing.json(),{key:null,properties:{}});
 const invalid=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config'),{GOOGLE_MAPS_BROWSER_KEY:'private-server-secret'});assert.deepEqual(await invalid.json(),{key:null,properties:{}});
 const post=await worker.fetch(new Request('https://sakanlodge.com/api/public/maps-config',{method:'POST'}),env);assert.equal(post.status,405);
});

test('public map configuration allows only approved suburb point coordinates and strips private fields',async()=>{
 const {publicMapProperties}=await import('./public-map-config.js');
 assert.deepEqual(publicMapProperties('invalid'),{});
 assert.deepEqual(publicMapProperties(JSON.stringify({fulham:{lat:-34.928296,lng:138.511307,address:'must not be exposed'},unknown:{lat:0,lng:0},clapham:{lat:0,lng:0}})),{fulham:{lat:-34.928296,lng:138.511307}});
});
