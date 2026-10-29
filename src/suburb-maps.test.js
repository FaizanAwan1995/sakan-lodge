import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {renderSuburbMap,renderSuburbLocationCards,suburbMapLinks} from './suburb-maps.js';

test('Google Maps embeds and directions target only the named South Australian suburbs',()=>{
 for(const [slug,name] of [['fulham','Fulham'],['clapham','Clapham'],['oaklands-park','Oaklands Park']]){
  const m=suburbMapLinks(slug),embed=new URL(m.embed),directions=new URL(m.directions);
  assert.equal(embed.hostname,'maps.google.com');assert.equal(embed.searchParams.get('q'),`${name}, South Australia, Australia`);assert.equal(embed.searchParams.get('output'),'embed');
  assert.equal(directions.searchParams.get('api'),'1');assert.equal(directions.searchParams.get('origin'),`${name}, South Australia, Australia`);assert.equal(directions.searchParams.get('destination'),'Adelaide CBD, South Australia, Australia');
  for(const [,url] of m.nearby){const u=new URL(url);assert.equal(u.hostname,'www.google.com');assert.equal(u.searchParams.get('api'),'1');assert.ok(u.searchParams.get('query').includes(`${name}, South Australia`));}
  const html=renderSuburbMap(slug);assert.ok(html.includes('loading="lazy"'));assert.ok(html.includes('referrerpolicy="strict-origin-when-cross-origin"'));assert.ok(html.includes('title="Interactive Google Map of '+name));assert.ok(html.includes('Suburb overview, not a property address'));
 }
 assert.equal(renderSuburbMap('unknown'), '');assert.equal(suburbMapLinks('<script>'),null);
});
test('homepage preserves crawlable room links and embeds maps separately from room navigation',()=>{
 const html=fs.readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
 assert.ok(html.includes(renderSuburbLocationCards()));
 assert.equal((html.match(/data-suburb-map=/g)||[]).length,3);
 for(const slug of ['fulham','clapham','oaklands-park'])assert.ok(html.includes(`href="/locations/${slug}/"`));
 assert.ok(!/<a[^>]*class="location-link"/.test(html));assert.ok(!html.includes('src="/suburbs/fulham-map.webp"'));assert.ok(html.includes('src="/suburb-maps.js" defer'));
});
test('map activation keeps scrolling passive, activates one map, and restores keyboard access and focus',()=>{
 const handler=fs.readFileSync(new URL('../public/suburb-maps.js',import.meta.url),'utf8');
 const element=()=>({dataset:{},attrs:{},hidden:true,textContent:'',handlers:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},addEventListener(k,f){this.handlers[k]=f;},focus(){this.focused=true;}});
 function panel(){const p=element(),frame=element(),toggle=element(),help=element(),loading=element();const parts={iframe:frame,'[data-map-toggle]':toggle,'[data-map-help]':help,'[data-map-loading]':loading};p.querySelector=s=>parts[s];return {p,frame,toggle,help,loading};}
 const a=panel(),b=panel(),doc={querySelectorAll:()=>[a.p,b.p]};const timers=new Set();
 const context={module:{exports:{}},setTimeout:f=>{timers.add(f);return f;},clearTimeout:f=>timers.delete(f)};context.globalThis=context;vm.runInNewContext(handler,context);const {initSuburbMaps}=context.module.exports;
 initSuburbMaps(doc);assert.equal(a.frame.tabIndex,-1);assert.equal(a.p.dataset.mapActive,'false');assert.equal(a.toggle.hidden,false);
 a.toggle.handlers.click();assert.equal(a.frame.tabIndex,0);assert.equal(a.frame.attrs['inert'],undefined);assert.equal(a.toggle.textContent,'Back to page');
 b.toggle.handlers.click();assert.equal(a.p.dataset.mapActive,'false');assert.equal(b.p.dataset.mapActive,'true');
 let prevented=false;b.p.handlers.keydown({key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(b.toggle.focused,true);assert.equal(b.frame.tabIndex,-1);
 a.frame.handlers.load();assert.equal(a.loading.hidden,true);
 assert.equal(initSuburbMaps(doc).length,0);
});
