import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PUBLIC_RATES, PUBLIC_RATE_FACTS, renderPublicRates, COUPLES_FAQ} from '../src/public-offers.js';
import {ROOM_FACTS} from '../src/room-assistant.js';
const context={URLSearchParams,crypto};
vm.runInNewContext(readFileSync(new URL('../public/enquiry-context.js',import.meta.url),'utf8'),context);
const helper=context.SakanEnquiryContext;
const form = () => {const fields=Object.fromEntries(['location','accommodation','move_in','message','occupants'].map(k=>[k,{value:k==='occupants'?'1':''}]));return {fields,elements:{namedItem:k=>fields[k]}};};
test('room context survives navigation without contact details or untrusted prices',()=>{
 const url=helper.link({location:'Oaklands Park',offer:'shared',arrival:'2030-01-01',departure:'2030-03-01',occupants:'2',room_title:'Room & garden',email:'guest@example.test',price:'$1'});
 assert.ok(!url.includes('email'));assert.ok(!url.includes('price'));
 const f=form();helper.apply(f,helper.read(url.split('?')[1]));
 assert.equal(f.fields.location.value,'Oaklands Park');assert.equal(f.fields.accommodation.value,'Shared accommodation');assert.equal(f.fields.move_in.value,'2030-01-01');assert.equal(f.fields.occupants.value,'2');assert.match(f.fields.message.value,/Room & garden/);assert.match(f.fields.message.value,/2030-03-01/);
});
test('invalid dates, arbitrary offers and unknown locations do not prefill valid controls',()=>{
 const c=helper.read('?location=Nowhere&offer=__proto__&audience=admin&arrival=2030-02-30&departure=bad&occupants=999');
 assert.equal(Object.keys(c).length,0);
 const reversed=helper.read('?arrival=2030-03-01&departure=2030-01-01');assert.equal(reversed.departure,undefined);
});
test('couples selection carries correct occupancy and existing editable choices are retained',()=>{
 const f=form();helper.apply(f,helper.read('?audience=couples'));
 assert.equal(f.fields.occupants.value,'2');assert.equal(f.fields.location.value,'Fulham');assert.equal(f.fields.accommodation.value,'Private room');assert.match(f.fields.message.value,/granny flat/);
 f.fields.location.value='Clapham';f.fields.message.value='My own details';helper.apply(f,helper.read('?offer=short&location=Fulham'));
 assert.equal(f.fields.location.value,'Clapham');assert.equal(f.fields.message.value,'My own details');
});
test('homepage prices and couples answer stay synchronized with shared public facts',()=>{
 const html=readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
 assert.ok(html.includes(renderPublicRates()));assert.ok(html.includes(COUPLES_FAQ));assert.ok(ROOM_FACTS.includes(PUBLIC_RATE_FACTS));
 for(const rate of Object.values(PUBLIC_RATES))assert.ok(html.includes('$'+rate.toLocaleString('en-AU')));
});

test('request identifiers remain UUIDs when randomUUID is unavailable',()=>{
 const fallback={URLSearchParams,crypto:{getRandomValues:bytes=>crypto.getRandomValues(bytes)}};vm.runInNewContext(readFileSync(new URL('../public/enquiry-context.js',import.meta.url),'utf8'),fallback);
 const a=fallback.SakanEnquiryContext.requestId(),b=fallback.SakanEnquiryContext.requestId();assert.match(a,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.notEqual(a,b);
});
