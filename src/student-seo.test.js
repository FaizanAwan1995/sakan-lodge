import test from 'node:test';import assert from 'node:assert/strict';
import {handlePublicSite,renderListing} from './public-site.js';import worker from './worker.js';
import {STUDENT_PATH} from './student-accommodation.js';
test('student guide is crawlable server HTML without database access and explains prices honestly',async()=>{
 const response=await handlePublicSite(new Request('https://sakanlodge.com'+STUDENT_PATH),{});assert.equal(response.status,200);const page=await response.text();
 assert.match(page,/<h1>Student accommodation in Adelaide, South Australia<\/h1>/);assert.ok(page.includes('rel="canonical" href="https://sakanlodge.com'+STUDENT_PATH+'"'));assert.ok(page.includes('$185 per person'));assert.ok(page.includes('$255'));assert.ok(page.includes('$300'));assert.ok(page.includes('Two calendar months'));assert.ok(page.includes('not university-operated'));assert.ok(!page.includes('noindex'));
 const data=JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(data['@graph'][0].url,'https://sakanlodge.com'+STUDENT_PATH);
 for(const suburb of ['fulham','clapham','oaklands-park'])assert.ok(page.includes('/locations/'+suburb+'/'));
 const redirect=await handlePublicSite(new Request('https://sakanlodge.com/student-accommodation-adelaide'),{});assert.equal(redirect.status,308);
 assert.equal((await handlePublicSite(new Request('https://sakanlodge.com'+STUDENT_PATH,{method:'POST'}),{})).status,405);
});
test('room metadata describes the real room, location and public photos',async()=>{
 const cat={properties:[{id:'p',slug:'house',name:'Verified house',suburb:'Fulham',description:'Verified description'}],rooms:[{id:'r',property_id:'p',slug:'room',title:'Room 4',description:'Approved room details',capacity:1,photos:['https://images.example.test/room.jpg'],amenities:[]}]};
 const page=await renderListing({kind:'room',suburb:'fulham',property:'house',room:'room'},cat).text();assert.ok(page.includes('Fulham, Adelaide'));assert.ok(page.includes('property="og:image" content="https://images.example.test/room.jpg"'));
 const data=JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(data['@graph'][0]['@type'],'Accommodation');assert.equal(data['@graph'][0].occupancy.maxValue,1);assert.equal(data['@graph'][1]['@type'],'BreadcrumbList');assert.ok(!page.includes('aggregateRating'));
});
test('duplicate landing URL redirects to the canonical homepage while preserving campaign query',async()=>{
 const r=await worker.fetch(new Request('https://sakanlodge.com/landing.html?utm_source=test'),{});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'https://sakanlodge.com/?utm_source=test');
});
test('sitemap includes the student guide and public room image URLs without ledger URLs',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({properties:[{id:'p',suburb:'Fulham',slug:'house'}],rooms:[{property_id:'p',slug:'room',photos:['https://images.example.test/room.jpg?a=1&b=2','javascript:bad']}]});
 try{const r=await handlePublicSite(new Request('https://sakanlodge.com/sitemap.xml'),{SUPABASE_URL:'https://example.test',SUPABASE_PUBLIC_KEY:'public'});assert.equal(r.status,200);const xml=await r.text();assert.ok(xml.includes('https://sakanlodge.com'+STUDENT_PATH));assert.ok(xml.includes('xmlns:image='));assert.ok(xml.includes('room.jpg?a=1&amp;b=2'));assert.ok(!xml.includes('javascript:'));assert.ok(!xml.includes('/ledger'));}finally{globalThis.fetch=original;}
});
test('unavailable homepage assets return retryable 503 rather than an indexable loading placeholder',async()=>{
 const r=await worker.fetch(new Request('https://sakanlodge.com/'),{ASSETS:{fetch:async()=>new Response('missing',{status:404})}});assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'300');
});
test('search branding uses the real square logo and conventional favicon resolves',async()=>{
 const {readFileSync}=await import('node:fs');
 const home=readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
 const schemas=[...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/sg)].map(m=>JSON.parse(m[1]));
 assert.equal(schemas.find(s=>s['@type']==='WebSite').name,'SAKAN Lodge');
 assert.ok(home.includes('sizes="540x540" href="/sakan-logo-circle-main.png"'));
 const png=readFileSync(new URL('../public/sakan-logo-circle-main.png',import.meta.url));assert.equal(png.readUInt32BE(16),540);assert.equal(png.readUInt32BE(20),540);
 const response=await worker.fetch(new Request('https://sakanlodge.com/favicon.ico'),{});assert.equal(response.status,301);assert.equal(response.headers.get('location'),'https://sakanlodge.com/sakan-logo-circle-main.png');
 const guide=await (await handlePublicSite(new Request('https://sakanlodge.com'+STUDENT_PATH),{})).text();assert.ok(guide.includes('sizes="540x540" href="/sakan-logo-circle-main.png"'));
});
