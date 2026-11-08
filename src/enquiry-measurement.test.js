import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnquiryMeasurement} from '../public/enquiry-measurement.js';
import {enquiriesApi} from './enquiries-api.js';
const id='12345678-1234-4234-8234-123456789abc';
function browser(){const scripts=[];return {root:{},scripts,doc:{createElement:()=>({}),head:{append:s=>scripts.push(s)}}};}
test('invalid configuration and absent consent never load advertising or send a conversion',()=>{
 const b=browser();assert.equal(createEnquiryMeasurement('not-a-tag',b.root,b.doc),null);
 const tracker=createEnquiryMeasurement('AW-123456/Lead_Label',b.root,b.doc);
 assert.equal(tracker.received(id),false);tracker.consent(false);assert.deepEqual(b.scripts,[]);assert.equal(b.root.dataLayer,undefined);
});
test('consented confirmed receipts send one anonymous event per submission and revocation stops future events',()=>{
 const b=browser(),tracker=createEnquiryMeasurement('AW-123456/Lead_Label',b.root,b.doc);
 tracker.consent(true);tracker.consent(true);assert.equal(b.scripts.length,1);
 assert.equal(b.root.dataLayer[0][0],'consent');assert.equal(b.root.dataLayer[0][2].ad_storage,'denied');
 assert.equal(tracker.received(id),true);assert.equal(tracker.received(id),false);
 const events=b.root.dataLayer.filter(x=>x[0]==='event');assert.equal(events.length,1);
 assert.deepEqual(events[0][2],{send_to:'AW-123456/Lead_Label',transaction_id:id});
 tracker.consent(false);assert.equal(tracker.received('22345678-1234-4234-8234-123456789abc'),false);
 assert.equal(tracker.received('person@example.test'),false);
});
test('enquiry configuration exposes only a validated public Ads destination, never credentials',async()=>{
 const request=new Request('https://sakanlodge.com/api/enquiries');
 for(const destination of [undefined,'wrong','AW-123456/Lead_Label']){
  const cfg=await (await enquiriesApi(request,{GOOGLE_ADS_ENQUIRY_SEND_TO:destination,TURNSTILE_SECRET_KEY:'private-secret'})).json();
  assert.equal(cfg.conversion_send_to,destination==='AW-123456/Lead_Label'?destination:undefined);
  assert.ok(!JSON.stringify(cfg).includes('private-secret'));
 }
});
