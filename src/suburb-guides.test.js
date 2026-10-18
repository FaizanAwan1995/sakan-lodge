import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderListing} from './public-site.js';
import {SUBURB_GUIDES} from './suburb-guides.js';
const property={id:'p1',name:'Noor House',slug:'fulham-house-1',suburb:'Fulham',description:'Approved house'};
const room={id:'r1',property_id:'p1',slug:'room-3',title:'Noor 03 · Private Room',capacity:1};
test('single visible property links straight to rooms and retains nested URLs',async()=>{
 const text=await renderListing({kind:'location',suburb:'fulham'},{properties:[property],rooms:[room]}).text();
 assert.ok(text.includes('href="/locations/fulham/properties/fulham-house-1/rooms/room-3/"'));
 assert.ok(!text.includes('href="/locations/fulham/properties/fulham-house-1/"'));
 assert.ok(text.includes('Noor House'));
});
test('multiple visible properties restore property selection',async()=>{
 const text=await renderListing({kind:'location',suburb:'fulham'},{properties:[property,{...property,id:'p2',slug:'second-house',name:'Another house'}],rooms:[room]}).text();
 assert.ok(text.includes('href="/locations/fulham/properties/fulham-house-1/"'));
 assert.ok(text.includes('href="/locations/fulham/properties/second-house/"'));
});
test('all three suburb guides render without vacancies, with matching local maps and source links',async()=>{
 for(const [slug,g] of Object.entries(SUBURB_GUIDES)){
  const text=await renderListing({kind:'location',suburb:slug},{properties:[],rooms:[]}).text();
  assert.ok(text.includes('No rooms are currently advertised'));
  assert.ok(text.includes('Life around '+g.name));
  assert.ok(text.includes('src="'+g.image+'"'));
  assert.ok(fs.existsSync(new URL('../public'+g.image,import.meta.url)));
  assert.equal(g.features.length,4);
  assert.ok(text.includes('aria-hidden="true" focusable="false"'));
  for(const f of g.features)assert.ok(text.includes('href="'+f.href+'"'));
 }
});
