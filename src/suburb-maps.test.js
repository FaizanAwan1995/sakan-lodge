import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {renderSuburbMap,renderSuburbLocationCards,suburbMapLinks} from './suburb-maps.js';

test('satellite overview, nearby searches and CBD routes all use embedded Google Maps',()=>{
 for(const [slug,name] of [['fulham','Fulham'],['clapham','Clapham'],['oaklands-park','Oaklands Park']]){
  const m=suburbMapLinks(slug),overview=new URL(m.embed),route=new URL(m.directions);
  assert.equal(overview.searchParams.get('q'),`${name}, South Australia, Australia`);assert.equal(overview.searchParams.get('z'),'14');
  assert.equal(route.searchParams.get('saddr'),`${name}, South Australia, Australia`);assert.equal(route.searchParams.get('daddr'),'Adelaide CBD, South Australia, Australia');
  for(const url of [m.embed,m.directions,...m.nearby.map(([,u])=>u)]){const u=new URL(url);assert.equal(u.hostname,'maps.google.com');assert.equal(u.searchParams.get('output'),'embed');assert.equal(u.searchParams.get('t'),'k');}
  for(const [,url] of m.nearby)assert.ok(new URL(url).searchParams.get('q').includes(`${name}, South Australia`));
  const html=renderSuburbMap(slug);assert.ok(html.includes('loading="lazy"'));assert.ok(html.includes(`name="suburb-map-${slug}"`));assert.ok(html.includes(`title="Interactive satellite map of ${name}`));
  assert.equal((html.match(new RegExp(`target="suburb-map-${slug}"`,'g'))||[]).length,5);assert.ok(!html.includes('target="_blank"'));assert.ok(!html.includes('data-map-toggle'));assert.ok(!html.includes('inert'));assert.ok(html.includes('Suburb overview, not a property address'));
 }
 assert.equal(renderSuburbMap('unknown'),'');assert.equal(suburbMapLinks('<script>'),null);
});
test('suburb titles sit above live widgets and room navigation remains distinct and crawlable',()=>{
 const html=fs.readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');assert.ok(html.includes(renderSuburbLocationCards()));
 assert.equal((html.match(/data-suburb-map=/g)||[]).length,3);
 for(const [slug,name] of [['fulham','Fulham'],['clapham','Clapham'],['oaklands-park','Oaklands Park']]){assert.ok(html.indexOf(`<h3>${name}</h3>`)<html.indexOf(`data-suburb-map="${slug}"`));assert.ok(html.includes(`href="/locations/${slug}/"`));}
 assert.ok(!html.includes('Explore map</button>'));assert.ok(!html.includes('src="/suburbs/fulham-map.webp"'));
 const css=fs.readFileSync(new URL('../public/site-ui.css',import.meta.url),'utf8');assert.ok(!css.includes('iframe{pointer-events:none}'));assert.ok(css.includes('.suburb-map-in-view #floating-contact'));
});
test('nearby actions change the iframe without leaving the page or blocking touch interaction',()=>{
 const source=fs.readFileSync(new URL('../public/suburb-maps.js',import.meta.url),'utf8');
 const element=()=>({dataset:{},attrs:{},handlers:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];},addEventListener(k,f){this.handlers[k]=f;}});
 const panel=element(),frame=element(),status=element();panel.dataset.suburbName='Fulham';frame.attrs.inert='';frame.attrs['aria-hidden']='true';
 const links=['Overview','Transport','Groceries','Parks','CBD route'].map((label,i)=>{const e=element();e.dataset.mapView=label;e.attrs.href=i===4?suburbMapLinks('fulham').directions:i===0?suburbMapLinks('fulham').embed:suburbMapLinks('fulham').nearby[i-1][1];return e;});
 panel.querySelector=s=>s==='iframe'?frame:status;panel.querySelectorAll=()=>links;
 const toggles=[],observers=[],doc={querySelectorAll:()=>[panel],body:{classList:{toggle:(...args)=>toggles.push(args)}}};
 const context={module:{exports:{}},IntersectionObserver:class{constructor(cb){this.cb=cb;observers.push(this);}observe(p){this.panel=p;}}};context.globalThis=context;vm.runInNewContext(source,context);
 const {initSuburbMaps}=context.module.exports;initSuburbMaps(doc);assert.equal(frame.tabIndex,0);assert.equal(frame.attrs.inert,undefined);assert.equal(frame.attrs['aria-hidden'],undefined);
 let prevented=false;links[1].handlers.click({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(frame.attrs.src,links[1].attrs.href);assert.equal(links[1].attrs['aria-current'],'true');assert.match(status.textContent,/transport for Fulham in this map/);
 links[4].handlers.click({preventDefault(){}});assert.equal(frame.attrs.src,links[4].attrs.href);assert.equal(links[1].attrs['aria-current'],undefined);
 observers[0].cb([{isIntersecting:true}]);assert.deepEqual(toggles.at(-1),['suburb-map-in-view',true]);observers[0].cb([{isIntersecting:false}]);assert.deepEqual(toggles.at(-1),['suburb-map-in-view',false]);
 assert.equal(initSuburbMaps(doc).length,0);
});
