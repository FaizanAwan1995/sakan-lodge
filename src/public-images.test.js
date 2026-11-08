import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {publicImageSrc,responsiveImageAttributes} from './public-images.js';
import {GRANNY_FLAT_PHOTOS} from './accommodation-segments.js';
import worker from './worker.js';

test('approved gallery images use small responsive files while new uploads retain their original URL',()=>{
 for(const src of GRANNY_FLAT_PHOTOS){
  const attrs=responsiveImageAttributes(src,'100vw');
  assert.match(attrs,/srcset=".*-640.webp 640w, .*?-1200.webp 1200w" sizes="100vw"/);
  const file=publicImageSrc(src);
  assert.ok(fs.statSync(new URL('../public'+file,import.meta.url)).size<150000);
 }
 const uploaded='https://images.example.test/photo.jpg';
 assert.equal(publicImageSrc(uploaded),uploaded);
 assert.equal(responsiveImageAttributes(uploaded,'100vw'),'src="'+uploaded+'"');
 assert.doesNotMatch(responsiveImageAttributes('" onerror="alert(1)','100vw'),/src="" onerror=/);
});

test('key search landing pages allow indexing and keep self-canonicals; private routes remain excluded',async()=>{
 for(const path of ['/accommodation/couples/','/accommodation/women/','/muslim-friendly-accommodation-adelaide/','/student-accommodation-adelaide/']){
  const response=await worker.fetch(new Request('https://sakanlodge.com'+path),{});
  assert.equal(response.status,200,path);
  assert.doesNotMatch(response.headers.get('x-robots-tag')||'',/noindex/);
  const body=await response.text();
  assert.match(body,/content="index,follow,max-image-preview:large"/);
  assert.ok(body.includes('rel="canonical" href="https://sakanlodge.com'+path+'"'));
 }
 const privateResponse=await worker.fetch(new Request('https://sakanlodge.com/ledger/'),{ASSETS:{fetch:async()=>new Response('<html>Ledger</html>')}});
 assert.match(privateResponse.headers.get('x-robots-tag'),/noindex/);
});
