import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {renderListing} from '../src/public-site.js';

test('duplicate public document paths redirect once and keep campaign parameters',async()=>{
 for(const [path,target] of [['/index.html','/ledger/'],['/privacy/','/privacy'],['/privacy.html','/privacy'],['/terms/','/terms'],['/terms.html','/terms'],['/enquire/','/enquire']]){
  const response=await worker.fetch(new Request('https://sakanlodge.com'+path+'?utm_source=search'),{});
  assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://sakanlodge.com'+target+'?utm_source=search');
 }
});
test('enquiry document has one robots directive and one canonical',async()=>{
 const home=readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
 const response=await worker.fetch(new Request('https://sakanlodge.com/enquire'),{ASSETS:{fetch:async()=>new Response(home)}});
 const page=await response.text();
 assert.equal((page.match(/<meta name="robots"/g)||[]).length,1);assert.match(page,/<meta name="robots" content="noindex,follow">/);
 assert.equal((page.match(/<link rel="canonical"/g)||[]).length,1);assert.match(page,/rel="canonical" href="https:\/\/sakanlodge.com\/enquire"/);
});
test('suburb landing pages explain rent and preserve selected location in enquiry link',async()=>{
 for(const [slug,name] of [['fulham','Fulham'],['clapham','Clapham'],['oaklands-park','Oaklands Park']]){
  const response=renderListing({kind:'location',suburb:slug},{properties:[],rooms:[]});const page=await response.text();
  assert.equal(response.status,200);assert.match(page,/<title>Rooms for Rent in/);assert.ok(page.includes(name));assert.ok(page.includes('$185 per person/week'));assert.ok(page.includes('href="/enquire?location='+encodeURIComponent(name)+'"'));
  assert.ok(page.includes('href="https://sakanlodge.com/locations/'+slug+'/"'));
 }
});
test('homepage has one WebSite entity and public missing assets cannot fall back to staff SPA',()=>{
 const home=readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
 const schemas=[...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/sg)].map(m=>JSON.parse(m[1]));
 assert.equal(schemas.filter(s=>s['@type']==='WebSite').length,1);
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');assert.match(config,/not_found_handling = "none"/);
});

test('location and women enquiry URLs prefill the existing form',async()=>{
 const {runInNewContext}=await import('node:vm');
 const script=readFileSync(new URL('../public/enquiry-context.js',import.meta.url),'utf8');
 for(const [search,expectedLocation,expectedOccupants] of [['?location=Oaklands%20Park','Oaklands Park','1'],['?audience=women&location=Fulham','Fulham','1'],['?audience=couples&location=Fulham','Fulham','2']]){
  const fields={location:{value:''},message:{value:''},occupants:{value:'1'}};
  const context={URLSearchParams};runInNewContext(script,context);context.SakanEnquiryContext.apply({elements:{namedItem:name=>fields[name]}},context.SakanEnquiryContext.read(search));
  assert.equal(fields.location.value,expectedLocation);assert.equal(fields.occupants.value,expectedOccupants);
 }
});
