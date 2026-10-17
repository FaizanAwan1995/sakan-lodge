import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFinancialRow, canDeleteFinancialRow, findPossibleDuplicatePayment } from './financial-safety.js';

test('rejects negative, zero, fractional-cent and missing-person payments',()=>{
 for(const amount of [-1,0,'1.234','abc',Infinity]) assert.ok(validateFinancialRow('payments',{person_id:'p',amount}));
 assert.ok(validateFinancialRow('payments',{amount:10}));
 assert.equal(validateFinancialRow('payments',{person_id:'p',amount:'10.50',date:'2026-10-16'}),null);
});
test('requires explicit confirmation for financial deletion',()=>{
 assert.equal(canDeleteFinancialRow('payments',''),false);
 assert.equal(canDeleteFinancialRow('payments','DELETE'),true);
 assert.equal(canDeleteFinancialRow('people',''),true);
});
test('identifies likely duplicate payment but not edits to the same record',()=>{
 const row={id:'1',person_id:'p',date:'2026-10-16',amount:100,kind:'rent',method:'cash',note:''};
 assert.equal(findPossibleDuplicatePayment([row],{...row,id:'2'},'2')?.id,'1');
 assert.equal(findPossibleDuplicatePayment([row],row,'1'),null);
});

test('rejects impossible transaction dates', () => {
 for (const date of ['2026-02-30', '2026-13-01', '2026-00-01']) assert.ok(validateFinancialRow('payments', { person_id: 'p', amount: 100, date }));
 assert.equal(validateFinancialRow('payments', { person_id: 'p', amount: 100, date: '2028-02-29' }), null);
});
