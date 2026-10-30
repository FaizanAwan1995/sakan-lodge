import test from 'node:test';import assert from 'node:assert/strict';
import worker from './worker.js';import {ledgerBasename,legacyLedgerPath,readLedgerVisit,saveLedgerVisit}from'./ledger-routing.js';import{startSessionResume}from'./session-resume.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const listeners=new Map(),doc={visibilityState:'visible',addEventListener:(type,fn)=>listeners.set('doc:'+type,fn),removeEventListener:type=>listeners.delete('doc:'+type)},win={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 let callback,session={user:{id:'staff'},access_token:'fresh'},calls=0;const states=[],errors=[];
 const auth={onAuthStateChange(fn){callback=fn;return{data:{subscription:{unsubscribe(){}}}};},getSession:options.getSession||async function(){calls++;return{data:{session},error:null};},getUser:options.getUser||(async()=>({data:{user:session?.user},error:null}))};
 const controller=startSessionResume({auth,onSession:s=>states.push(s),onError:e=>errors.push(e),window:win,document:doc,timeoutMs:options.timeoutMs||50});
 return{controller,states,errors,doc,listeners,emit:(...args)=>callback(...args),setSession:s=>session=s,calls:()=>calls};
}
test('Ledger root and legacy bookmarks redirect into the correct router base',async()=>{
 assert.equal(ledgerBasename('/ledger'),'/ledger/');assert.equal(ledgerBasename('/ledger/activity'),'/ledger/');assert.equal(ledgerBasename('/ledger-other'),'/');
 for(const [path,target]of[['/ledger','/ledger/'],['/activity','/ledger/activity'],['/reports?view=transactions','/ledger/reports?view=transactions'],['/signin','/ledger/signin']]){
  const response=await worker.fetch(new Request('https://sakanlodge.com'+path),{});assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://sakanlodge.com'+target);
 }
 assert.equal(legacyLedgerPath('/locations/fulham/'),null);assert.equal(legacyLedgerPath('/api/reservations'),null);
});
test('deep Ledger navigation always returns HTML without relying on mobile navigation headers',async()=>{
 for(const path of ['/ledger/','/ledger/activity','/ledger/rooms/staff-tenant','/ledger/website-photos']){
  let fetched;const response=await worker.fetch(new Request('https://sakanlodge.com'+path),{ASSETS:{fetch:async req=>{fetched=new URL(req.url).pathname;return new Response('<html>Ledger</html>');}}});
  assert.equal(fetched,'/index.html');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const missing=await worker.fetch(new Request('https://sakanlodge.com/ledger/missing.js'),{ASSETS:{fetch:async()=>new Response('Not found',{status:404})}});assert.equal(missing.status,404);
});
test('last page is per admin, survives return, excludes credentials and rejects unsafe targets',()=>{
 const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,v)=>map.set(key,v)};
 saveLedgerVisit(storage,'staff','/reports','?view=transactions&access_token=secret&code=oauth',420);const saved=readLedgerVisit(storage,'staff');assert.equal(saved.pathname,'/reports');assert.equal(saved.search,'?view=transactions');assert.equal(saved.scroll,420);assert.equal(readLedgerVisit(storage,'other'),null);
 saveLedgerVisit(storage,'staff','/signin','',0);assert.equal(readLedgerVisit(storage,'staff').pathname,'/reports');storage.setItem('sakan-ledger-visit:staff',JSON.stringify({pathname:'//evil.test',search:''}));assert.equal(readLedgerVisit(storage,'staff'),null);
});
test('valid sessions recheck on return after three hours and expired sessions go to login state',async()=>{
 const c=fixture();await flush();assert.equal(c.states.at(-1).user.id,'staff');c.doc.visibilityState='hidden';c.listeners.get('doc:visibilitychange')();await flush();assert.equal(c.calls(),1);
 // Simulate the browser waking long after the original access token expired.
 c.setSession({user:{id:'staff'},access_token:'refreshed-after-three-hours'});c.doc.visibilityState='visible';c.listeners.get('pageshow')();await flush();assert.equal(c.states.at(-1).access_token,'refreshed-after-three-hours');
 c.setSession(null);await c.controller.check();assert.equal(c.states.at(-1),null);c.controller.stop();assert.equal(c.listeners.size,0);
});
test('invalid sessions redirect, but temporary network failures offer retry without signing out',async()=>{
 const expired=fixture({getUser:async()=>({error:{status:401,code:'bad_jwt'}})});await flush();assert.equal(expired.states.at(-1),null);expired.controller.stop();
 const offline=fixture({getUser:async()=>{throw Error('Failed to fetch');}});await flush();assert.equal(offline.states.length,0);assert.match(offline.errors.at(-1),/reconnect/);offline.controller.stop();
});
test('late session checks cannot undo sign out; hanging checks become retryable',async()=>{
 let release;const c=fixture({getSession:()=>new Promise(resolve=>release=resolve)});c.emit('SIGNED_OUT',null);release({data:{session:{user:{id:'staff'}}}});await flush();assert.deepEqual(c.states,[null]);c.controller.stop();
 const hung=fixture({getSession:()=>new Promise(()=>{}),timeoutMs:5});await new Promise(r=>setTimeout(r,15));assert.match(hung.errors.at(-1),/reconnect/);hung.controller.stop();
});
