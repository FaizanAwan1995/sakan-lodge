import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {renderSuburbMap,renderSuburbLocationCards,suburbMapLinks} from './suburb-maps.js';
function controller(adapter){const context={module:{exports:{}}};context.globalThis=context;vm.runInNewContext(fs.readFileSync(new URL('../public/suburb-maps.js',import.meta.url),'utf8'),context);return context.module.exports.createViewController(adapter);}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('native satellite widgets have accessible category controls and no eager Google iframes',()=>{
 for(const [slug,name] of [['fulham','Fulham'],['clapham','Clapham'],['oaklands-park','Oaklands Park']]){
  const m=suburbMapLinks(slug),html=renderSuburbMap(slug);assert.ok(m.center.lat<-34&&m.center.lat>-36);assert.ok(m.center.lng>138&&m.center.lng<139);
  assert.ok(html.includes(`aria-label="Interactive satellite map of ${name}`));assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('maps.googleapis.com'));assert.equal((html.match(/data-map-view=/g)||[]).length,5);assert.ok(html.includes('data-map-results'));assert.ok(html.includes('data-map-retry hidden'));assert.ok(html.includes('Suburb overview, not a property address'));
 }
 assert.equal(renderSuburbMap('unknown'),'');assert.equal(suburbMapLinks('<script>'),null);
 const html=fs.readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');assert.ok(html.includes(renderSuburbLocationCards()));
 for(const [slug,name] of [['fulham','Fulham'],['clapham','Clapham'],['oaklands-park','Oaklands Park']]){assert.ok(html.indexOf(`<h3>${name}</h3>`)<html.indexOf(`data-suburb-map="${slug}"`));assert.ok(html.includes(`href="/locations/${slug}/"`));}
});
test('category changes keep the map and deduplicate nearby and route requests per page session',async()=>{
 const loaded=[],paints=[],calls=[];const c=controller({load:async()=>loaded.push(true),loading:()=>{},error:e=>assert.fail(e),paint:(...a)=>paints.push(a),nearby:async view=>{calls.push(view);return ['result'];},route:async()=>{calls.push('route');return {path:[]};}});
 await c.select('Overview');assert.equal(calls.length,0);
 await c.select('Parks');await c.select('Overview');await c.select('Parks');assert.deepEqual(calls,['Parks']);assert.deepEqual(paints.at(-1),['Parks',['result']]);
 await c.select('CBD route');await c.select('CBD route');assert.deepEqual(calls,['Parks','route']);
});
test('late results and failures cannot replace a newer selection',async()=>{
 const park=deferred(),transport=deferred(),paint=[],errors=[];
 const c=controller({load:async()=>{},loading:()=>{},paint:(view,data)=>paint.push([view,data]),error:(...a)=>errors.push(a),nearby:view=>view==='Parks'?park.promise:transport.promise});
 const first=c.select('Transport');await flush();const second=c.select('Parks');await flush();park.resolve(['park']);await second;transport.reject(new Error('late failure'));await first;assert.equal(paint.length,1);assert.deepEqual(paint[0],['Parks',['park']]);assert.equal(errors.length,0);
});
test('failure is explicit, can be retried and never announces a successful result',async()=>{
 const events=[];let count=0;const c=controller({load:async()=>{},loading:v=>events.push(['loading',v]),paint:v=>events.push(['paint',v]),error:v=>events.push(['error',v]),nearby:async()=>{if(++count===1)throw new Error('quota');return [];}});
 await c.select('Parks');assert.deepEqual(events,[['loading','Parks'],['error','Parks']]);await c.select('Parks');assert.deepEqual(events.at(-1),['paint','Parks']);assert.equal(count,2);
});
test('repeated clicks while a request is running share the same request',async()=>{
 const pending=deferred();let calls=0;const painted=[];const c=controller({load:async()=>{},loading:()=>{},paint:v=>painted.push(v),error:()=>assert.fail(),nearby:()=>{calls++;return pending.promise;}});
 const one=c.select('Parks');await flush();const two=c.select('Parks');await flush();assert.equal(calls,1);pending.resolve([]);await Promise.all([one,two]);assert.deepEqual(painted,['Parks']);
});
