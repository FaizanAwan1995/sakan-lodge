import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantStatement, propertyProfitability, csvRows } from './finance-utils.js';

const db = {
  properties:[{id:'p',name:'Test',lease_rent:200,lease_start:'2026-10-01',lease_anchor:'2026-10-01'}],
  people:[{id:'t',name:'Tenant',property_id:'p',start_date:'2026-10-01',stay_type:'long',weekly_rate:100,bond:200}],
  charges:[],payments:[{person_id:'t',property_id:'p',date:'2026-10-02',amount:200,kind:'rent'},{person_id:'t',property_id:'p',date:'2026-10-03',amount:200,kind:'bond'}],
  expenses:[{property_id:'p',date:'2026-10-04',amount:25}],
};
test('tenant statement separates bond money from rent credits',()=>{
 const x=tenantStatement(db,'t','2026-10-05');
 assert.equal(x.bondHeld,200);
 assert.equal(x.transactions.filter(r=>r.credit).length,1);
 assert.equal(x.transactions.find(r=>r.credit).credit,200);
});
test('received result excludes bonds and keeps scheduled costs separate',()=>{
 const [p]=propertyProfitability(db,'2026-10-01','2026-10-05');
 assert.equal(p.rent,200);
 assert.equal(p.expenses,25);
 assert.equal(p.net,175);
 assert.equal(p.earned,200);
 assert.equal(p.operatingExpenses,225);
 assert.equal(p.operatingNet,-25);
});
test('CSV quotes embedded commas and formulas as text fields',()=>{
 const s=csvRows([['Name','Note'],['Tenant','a,b']]);
 assert.match(s,/"a,b"/);
});

test('admin balance credit appears as a noncash credit in statements and does not increase cash receipts',()=>{
 const credited={...db,charges:[{id:'credit',person_id:'t',kind:'adjustment',due_date:'2026-10-05',amount:-25,note:'Admin authorised credit'}]};
 const s=tenantStatement(credited,'t','2026-10-05');
 assert.equal(s.transactions.find(r=>r.description.startsWith('Admin balance credit')).credit,25);
 assert.equal(s.person.paid,200);
 assert.equal(propertyProfitability(credited,'2026-10-01','2026-10-31','2026-10-05')[0].rent,200);
});
