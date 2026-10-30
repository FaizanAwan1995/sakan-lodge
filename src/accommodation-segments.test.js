import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePublicSite,renderListing} from './public-site.js';
import {renderSegmentPage,renderSegmentChoices} from './accommodation-segments.js';
import fs from 'node:fs';
test('each accommodation path renders without depending on database availability',async()=>{
 for(const key of ['men','women','couples']){
  const response=await handlePublicSite(new Request(`https://sakanlodge.com/accommodation/${key}/`),{});
  assert.equal(response.status,200);const body=await response.text();assert.ok(body.includes(`data-stay-segment="${key}"`));assert.ok(body.includes(`rel="canonical" href="https://sakanlodge.com/accommodation/${key}/"`));
  for(const contact of ['https://wa.me/61426721787','https://m.me/SakanLodge','tel:+61426721787','mailto:sakanlodges@gmail.com','data-audience-enquiry'])assert.ok(body.includes(contact));
  const redirect=await handlePublicSite(new Request(`https://sakanlodge.com/accommodation/${key}`),{});assert.equal(redirect.status,308);
  assert.equal((await handlePublicSite(new Request(`https://sakanlodge.com/accommodation/${key}/`,{method:'POST'}),{})).status,405);
 }
});
test('women are directed to Fulham with the transition explicit; couples suitability is not assumed',()=>{
 const women=renderSegmentPage('women'),men=renderSegmentPage('men'),couples=renderSegmentPage('couples');
 assert.ok(women.includes('href="/locations/fulham/#available-heading"'));assert.ok(!women.includes('href="/locations/clapham/#available-heading"'));assert.ok(women.includes('transitioning the household'));assert.ok(!men.includes('href="/locations/fulham/#available-heading"'));assert.ok(couples.includes('capacity alone does not confirm couples suitability'));assert.ok(couples.includes('single-occupancy private rooms are for one person'));assert.equal(renderSegmentPage('unknown'),'');
 assert.ok(fs.readFileSync(new URL('../public/landing.html',import.meta.url),'utf8').includes(renderSegmentChoices()));
});
test('Fulham listing keeps the existing booking form and shows household transition notice',async()=>{
 const cat={properties:[{id:'p',suburb:'Fulham',slug:'sakan-fulham',name:'Sakan Fulham',photos:[],amenities:[]}],rooms:[{id:'r',property_id:'p',slug:'room-1',title:'Room 1',capacity:1,photos:[],amenities:[]}]};
 const body=await renderListing({kind:'room',suburb:'fulham',property:'sakan-fulham',room:'room-1'},cat,{}).text();assert.ok(body.includes('transitioning to women-only'));assert.ok(body.includes('id="reservation-form"'));assert.ok(body.includes('id="check-availability"'));
});

test('segment maps match their suburbs and link straight to available rooms',()=>{
 for(const [key,slugs] of Object.entries({women:['fulham'],men:['clapham','oaklands-park'],couples:['clapham','oaklands-park']})){
  const body=renderSegmentPage(key);assert.equal((body.match(/data-suburb-map=/g)||[]).length,slugs.length);
  for(const slug of slugs){assert.ok(body.includes(`data-suburb-map="${slug}"`));assert.ok(body.includes(`href="/locations/${slug}/#available-heading"`));}
  assert.equal((body.match(/data-map-view=/g)||[]).length,slugs.length*5);assert.ok(body.indexOf('id="stay-rooms"')<body.indexOf('class="stay-values"'));assert.ok(body.includes('data-enquiry-location='));
 }
});
