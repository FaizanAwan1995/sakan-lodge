import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {sha256,validateSignatures,signedAgreementPdf} from './contract-signing.js';
import {contractSigningApi} from './contract-signing-api.js';
import worker from './worker.js';
const names=['Synthetic Signer'];
const signature={name:'Synthetic Signer',mode:'typed',consent:true,strokes:[]};
const token='1'.repeat(64),requestId='00000000-0000-4000-8000-000000000003';
const base=async()=>{const pdf=await PDFDocument.create();pdf.addPage([595,842]);const original=await pdf.save();return {original,snapshot:{code:'SYNTHETIC',request:{id:requestId,status:'awaiting_signature',document_hash:await sha256(original),expires_at:'2035-01-01T00:00:00Z'},contract:{id:'00000000-0000-4000-8000-000000000001',reservation_id:'00000000-0000-4000-8000-000000000002',version:1,document_path:'contracts/synthetic/original.pdf',fields:{resident_names:names,terms:'Synthetic terms',proprietor:{name:'Synthetic Owner',signature_png:'must-not-leak'},weekly_rate:255,bond:510}}}};};
const req=(action,body={},headers={})=>new Request('https://sakanlodge.com/api/contract-signing/'+action,{method:'POST',headers:{Origin:'https://sakanlodge.com','Content-Type':'application/json','X-Signing-Token':token,'CF-Connecting-IP':'192.0.2.1',...headers},body:JSON.stringify(body)});
const env={SUPABASE_URL:'https://synthetic.test',SUPABASE_PUBLIC_KEY:'public',SUPABASE_SECRET_KEY:'secret',ROOM_AI_LIMITER:{limit:async()=>({success:true})}};
test('every named resident must consent; malformed drawing data cannot reach PDF rendering',()=>{
 assert.deepEqual(validateSignatures([{...signature,name:'  synthetic   signer '}],names)[0].name,'synthetic signer');
 for(const bad of [[],[{...signature,name:'Other'}],[{...signature,consent:false}],[{...signature,mode:'drawn',strokes:[]}],[{...signature,mode:'drawn',strokes:[[[0,0],[Infinity,1]]]}]])assert.throws(()=>validateSignatures(bad,names));
});
test('signed copy retains original PDF pages and appends a receipt for every resident',async()=>{
 const {original,snapshot}=await base();snapshot.request={...snapshot.request,submitted_at:'2026-11-09T05:00:00.000Z',submission_hash:'b'.repeat(64),signatures:[signature,{name:'Second Signer',mode:'drawn',consent:true,strokes:[[[0,0],[1,1]]]}]};
 const bytes=await signedAgreementPdf(original,snapshot),pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),3);assert.deepEqual(pdf.getPage(0).getSize(),{width:595,height:842});assert.equal((await PDFDocument.load(original)).getPageCount(),1);
});
test('signing endpoints require same-origin JSON, a valid token and rate limiting',async()=>{
 assert.equal((await contractSigningApi(req('access',{}, {Origin:'https://other.test'}),env)).status,403);
 assert.equal((await contractSigningApi(req('access',{}, {'X-Signing-Token':'bad'}),env)).status,403);
 assert.equal((await contractSigningApi(req('access'),{...env,ROOM_AI_LIMITER:null})).status,503);
 assert.equal((await contractSigningApi(req('access'),{...env,ROOM_AI_LIMITER:{limit:async()=>({success:false})}})).status,429);
 assert.equal((await contractSigningApi(new Request('https://sakanlodge.com/api/contract-signing/access'),env)).status,405);
});
test('access response excludes private signing evidence, paths, tokens and signature artwork',async()=>{
 const {snapshot}=await base(),originalFetch=fetch;snapshot.request.evidence={network_fingerprint:'private'};
 globalThis.fetch=async()=>Response.json(snapshot);
 try{const r=await contractSigningApi(req('access'),env),data=await r.json();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(data.request.token_hash,undefined);assert.equal(data.request.evidence,undefined);assert.equal(data.contract,undefined);assert.equal(data.agreement.proprietor.signature_png,undefined);assert.equal(data.agreement.proprietor.name,'Synthetic Owner');}finally{globalThis.fetch=originalFetch;}
});
test('a lost storage response resumes one immutable signed artifact and never allocates tenants',async()=>{
 const {original,snapshot}=await base(),originalFetch=fetch;let uploaded,events=0,phase='awaiting_signature';const operations=[];
 globalThis.fetch=async(url,options)=>{
  const path=String(url);operations.push(path);
  if(path.includes('/rest/v1/rpc/')){const p=JSON.parse(options.body);assert.equal(options.headers.apikey,'secret');assert.equal(options.headers.Authorization,undefined);
   if(p.p_action==='begin'){phase='processing';snapshot.request={...snapshot.request,status:phase,submitted_at:'2026-11-09T05:00:00Z',submission_hash:p.p_data.submission_hash,signatures:p.p_data.signatures};}
   if(p.p_action==='complete'){events++;phase='signed';snapshot.request={...snapshot.request,status:phase,signed_document_path:p.p_data.path,signed_document_hash:p.p_data.signed_hash};}
   return Response.json(snapshot);
  }
  if(options.method==='POST'){uploaded=new Uint8Array(options.body);assert.equal(options.headers['x-upsert'],'false');return Response.json({message:'Previous attempt stored this file'},{status:409});}
  return new Response(path.endsWith('original.pdf')?original:uploaded,{headers:{'Content-Type':'application/pdf'}});
 };
 try{const body={document_hash:snapshot.request.document_hash,consent_version:'sakan-sign-v1',signatures:[signature]};const r=await contractSigningApi(req('submit',body),env);assert.equal(r.status,200);assert.equal((await r.json()).request.status,'signed');assert.equal(events,1);assert.equal((await PDFDocument.load(uploaded)).getPageCount(),2);const again=await contractSigningApi(req('submit',body),env);assert.equal(again.status,200);assert.equal(events,1);assert.ok(operations.every(p=>!p.includes('manual_booking')&&!p.includes('review_contract_signing')));}finally{globalThis.fetch=originalFetch;}
});
test('a changed source PDF is rejected before signatures or signed files can be stored',async()=>{
 const {original,snapshot}=await base(),originalFetch=fetch;snapshot.request.document_hash='f'.repeat(64);let mutation=false;
 globalThis.fetch=async(url,options)=>{if(String(url).includes('/rest/v1/rpc/')){const p=JSON.parse(options.body);if(p.p_action!=='access')mutation=true;return Response.json(snapshot);}return new Response(original);};
 try{const r=await contractSigningApi(req('submit',{document_hash:snapshot.request.document_hash,consent_version:'sakan-sign-v1',signatures:[signature]}),env);assert.equal(r.status,409);assert.equal(mutation,false);}finally{globalThis.fetch=originalFetch;}
});
test('signing page is private and does not load marketing scripts or leak its fragment token',async()=>{
 const html='<!doctype html><title>Private signing</title>';
 const r=await worker.fetch(new Request('https://sakanlodge.com/sign'),{ASSETS:{fetch:async()=>new Response(html)}});
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(r.headers.get('x-robots-tag'),/noindex/);
});
