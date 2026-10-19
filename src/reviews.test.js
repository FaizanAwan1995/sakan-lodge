import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReview,renderReviewSection} from './reviews.js';
import {reviewsApi} from './reviews-api.js';
import worker from './worker.js';
const input={display_name:'Guest Name',email:'GUEST@example.test',rating:4,review:'This is an honest review of my stay at the lodge.',suburb:'Clapham',consent:true};
const env={SUPABASE_URL:'https://database.example.test',SUPABASE_PUBLIC_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test',TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET_KEY:'secret'};
const req=(body=input,headers={})=>new Request('https://sakanlodge.com/api/reviews',{method:'POST',headers:{Origin:'https://sakanlodge.com','Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...headers},body:JSON.stringify({...body,turnstile_token:'token'})});
test('review validation and rendering do not publish private data or unescaped content',()=>{
 assert.equal(validateReview(input).email,'guest@example.test');
 for(const change of [{consent:false},{website:'spam'},{rating:6},{review:'short'},{display_name:'x'},{email:'wrong'},{suburb:'Made up'}])assert.throws(()=>validateReview({...input,...change}));
 const html=renderReviewSection([{...input,display_name:'<img src=x onerror=alert(1)>',review:'<script>alert(1)</script>'}],{siteKey:'safe',enabled:true});
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img src=x|GUEST@example.test|<script>alert/);assert.match(html,/name="consent" required/);assert.match(html,/disabled>Submit review/);
 assert.match(renderReviewSection([]),/Your story could be the first/);assert.doesNotMatch(renderReviewSection([]),/review-slide/);
});
test('public reviews endpoint fails closed for cross-origin, invalid details and missing verification',async()=>{
 assert.equal((await reviewsApi(req(input,{Origin:'https://evil.example'}),env)).status,403);
 assert.equal((await reviewsApi(req({...input,consent:false}),env)).status,400);
 assert.equal((await reviewsApi(req(input,{'Idempotency-Key':'bad'}),env)).status,400);
 assert.equal((await reviewsApi(req(),{})).status,503);
 assert.equal((await reviewsApi(new Request('https://sakanlodge.com/api/reviews',{method:'DELETE'}),env)).status,405);
});
test('verification enforces hostname and action; successful submission whitelists fields and hides private receipt',async()=>{
 const original=globalThis.fetch;let verified={success:true,hostname:'sakanlodge.com',action:'review'},submitted;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('siteverify'))return Response.json(verified);
  submitted=JSON.parse(options.body);return Response.json({received:true});
 };
 try{
  verified.action='reservation';assert.equal((await reviewsApi(req(),env)).status,400);assert.equal(submitted,undefined);
  verified={success:true,hostname:'evil.example',action:'review'};assert.equal((await reviewsApi(req(),env)).status,400);
  verified.hostname='sakanlodge.com';const res=await reviewsApi(req({...input,status:'published',stay_verified:true}),env);assert.equal(res.status,202);
  assert.equal(submitted.p_data.status,undefined);assert.equal(submitted.p_data.stay_verified,undefined);assert.match(submitted.p_fingerprint,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(await res.json()),/guest@example|secret|fingerprint/);
  globalThis.fetch=async()=>{throw Error('network error');};assert.equal((await reviewsApi(req(),env)).status,503);
 }finally{globalThis.fetch=original;}
});
test('homepage server renders approved reviews while keeping submission email private',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json([{display_name:'Previous guest',rating:4,review:'An actual submitted review visible after approval.',suburb:'Fulham'}]);
 try{const res=await worker.fetch(new Request('https://sakanlodge.com/'),{...env,ASSETS:{fetch:async()=>new Response('<main><!--SAKAN_REVIEWS--></main>')}});const body=await res.text();assert.match(body,/Previous guest/);assert.match(body,/Submit a review/);assert.match(body,/data-site-key="site"/);assert.doesNotMatch(body,/sb_secret/);}finally{globalThis.fetch=original;}
});
