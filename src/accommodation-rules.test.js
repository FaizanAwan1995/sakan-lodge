import test from 'node:test';
import assert from 'node:assert/strict';
import {addCalendarMonths,classifyStay,weeklyAdvertisedRate,dateRangesOverlap,availableSpaces} from './accommodation-rules.js';
test('exactly two calendar months is long-term',()=>{
 assert.equal(classifyStay('2026-10-18','2026-12-18'),'long');
 assert.equal(classifyStay('2026-10-18','2026-12-17'),'short');
});
test('calendar month calculation clamps end-of-month',()=>{
 assert.equal(addCalendarMonths('2026-12-31',2),'2027-02-28');
});
test('rates follow approved public policy',()=>{
 assert.equal(weeklyAdvertisedRate('shared','long'),185);
 assert.equal(weeklyAdvertisedRate('private','long'),255);
 assert.equal(weeklyAdvertisedRate('private','short'),300);
 assert.throws(()=>weeklyAdvertisedRate('shared','short'));
});
test('checkout date does not overlap next check-in',()=>{
 assert.equal(dateRangesOverlap('2026-10-01','2026-10-18','2026-10-18','2026-11-01'),false);
});
test('confirmed holds and current occupants reduce shared availability',()=>{
 assert.equal(availableSpaces({capacity:3,arrival:'2026-11-01',departure:'2026-12-01',offerType:'shared',residents:[{start:'2026-10-01',end:null}],holds:[{start:'2026-11-10',end:'2026-11-20'}]}),1);
});
test('private offers require entire room vacant',()=>{
 assert.equal(availableSpaces({capacity:2,arrival:'2026-11-01',departure:'2026-12-01',offerType:'private',residents:[{start:'2026-10-01',end:null}]}),0);
});
