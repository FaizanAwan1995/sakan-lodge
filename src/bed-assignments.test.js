import test from 'node:test';
import assert from 'node:assert/strict';
import {bedReference,bedChoices,parseBedNumbers} from './bed-assignments.js';
test('bed references are clear and arbitrary room labels are preserved',()=>{
 assert.equal(bedReference({label:'Room 5'},1),'R5-B1');assert.equal(bedReference({label:'Room 5 '},2),'R5-B2');assert.equal(bedReference({label:'Granny flat'},1),'Granny flat-B1');
 assert.deepEqual(parseBedNumbers('1, 2'),[1,2]);assert.deepEqual(parseBedNumbers(''),[]);assert.throws(()=>parseBedNumbers('1,1'));assert.throws(()=>parseBedNumbers('0'));assert.throws(()=>parseBedNumbers('1x'));
});
test('ledger bed choices respect actual checkout, date overlaps and self edits',()=>{
 const room={id:'r',label:'Room 5',capacity:2},person={id:'p',room_id:'r',start_date:'2030-01-01',end_date:'2030-04-01'};
 const current={id:'other',room_id:'r',bed_number:1,start_date:'2029-12-01',end_date:'2030-02-01'};
 assert.deepEqual(bedChoices({people:[current]},room,person).map(b=>b.busy),[true,false]);
 assert.equal(bedChoices({people:[{...current,checked_out_at:'2029-12-31T01:00:00Z'}]},room,person)[0].busy,false);
 assert.equal(bedChoices({people:[{...current,id:person.id}]},room,person)[0].busy,false);
});
