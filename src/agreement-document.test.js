import test from 'node:test';
import assert from 'node:assert/strict';
import { agreementDocument } from './agreement-document.js';
const snapshot = {version:2,status:'approved',fields:{full_name:'Fresh Applicant',resident_names:['Fresh Applicant','Second Resident'],arrival_date:'2026-10-18',departure_date:'2027-01-18',weekly_rate:185,offer_type:'shared',bond:370,terms:'Reviewed private terms <script>alert(1)</script>',proprietor:{name:'Example Lodge'},premises_address:'Synthetic test address',room_label:'Test room',template_reference:'test-v1'}};
test('agreement renders the immutable snapshot with all residents, bond, included utilities and fresh signatures',()=>{
 const html=agreementDocument(snapshot,'TEST-123');
 for(const text of ['Fresh Applicant','Second Resident','AUD $185.00/week per resident','AUD $370.00','Synthetic test address','Electricity, water, gas and internet included without additional charges']) assert.ok(html.includes(text));
 assert.equal((html.match(/Resident signature:/g)||[]).length,2);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));
});
test('nightly agreement shows the approved nightly amount, never weekly divided by seven',()=>{
 const c=structuredClone(snapshot);Object.assign(c.fields,{billing_type:'nightly',nightly_rate:55});
 const html=agreementDocument(c,'TEST');assert.ok(html.includes('AUD $55.00/night'));assert.ok(!html.includes('185.00/week'));
 delete c.fields.nightly_rate;assert.throws(()=>agreementDocument(c,'TEST'),/nightly rate/);
});
test('drafts are labelled and incomplete snapshots cannot become printable agreements',()=>{
 assert.ok(agreementDocument({...snapshot,status:'draft'},'TEST').includes('DRAFT'));
 assert.throws(()=>agreementDocument({fields:{}},'TEST'),/Incomplete/);
});
