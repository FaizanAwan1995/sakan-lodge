import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const script = await readFile(new URL('../public/reviews.js', import.meta.url), 'utf8');
function fixture({ reduced = false, count = 3 } = {}) {
  function element() {
    return { events: {}, attributes: {}, style: {}, textContent: '',
      addEventListener(name, fn) { this.events[name] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      fire(name, event = {}) { this.events[name]?.(event); } };
  }
  const carousel = element(), track = element(), prev = element(), next = element(), toggle = element(), position = element(), announcement = element(), viewport = element();
  const slides = Array.from({length:count}, element);
  const nodes = { '.review-track':track, '[data-review-prev]':prev, '[data-review-next]':next, '[data-review-toggle]':toggle, '[data-review-position]':position, '[data-review-announcement]':announcement, '.review-window':viewport };
  carousel.querySelector = key => nodes[key]; carousel.querySelectorAll = () => slides;
  carousel.contains = node => Object.values(nodes).includes(node);
  const document = element(); document.hidden = false; document.querySelector = () => carousel; document.getElementById = () => null;
  const motion = element(); motion.matches = reduced;
  let timerId = 0; const timers = new Map();
  runInNewContext(script, {document, window:{matchMedia:()=>motion}, setInterval(fn,ms){assert.equal(ms,8000);timers.set(++timerId,fn);return timerId;},clearInterval(id){timers.delete(id);}});
  return {carousel,track,prev,next,toggle,position,announcement,viewport,slides,document,motion,timers,tick(){[...timers.values()].forEach(fn=>fn());}};
}
test('carousel rotates automatically and pauses for hover, focus, explicit pause and hidden tabs',()=>{
  const f=fixture();assert.equal(f.timers.size,1);f.tick();assert.equal(f.track.style.transform,'translateX(-100%)');assert.equal(f.slides[1].attributes['aria-hidden'],'false');assert.equal(f.announcement.textContent,'');
  f.carousel.fire('mouseenter');assert.equal(f.timers.size,0);f.carousel.fire('mouseleave');assert.equal(f.timers.size,1);
  f.carousel.fire('focusin');assert.equal(f.timers.size,0);f.carousel.fire('focusout',{relatedTarget:f.next});assert.equal(f.timers.size,0);f.carousel.fire('focusout',{relatedTarget:null});assert.equal(f.timers.size,1);
  f.toggle.fire('click');assert.equal(f.timers.size,0);assert.equal(f.toggle.textContent,'Play');f.toggle.fire('click');assert.equal(f.timers.size,1);
  f.document.hidden=true;f.document.fire('visibilitychange');assert.equal(f.timers.size,0);f.document.hidden=false;f.document.fire('visibilitychange');assert.equal(f.timers.size,1);
});
test('manual navigation wraps, keyboard works and reduced motion never autoplays by default',()=>{
 const f=fixture({reduced:true});assert.equal(f.timers.size,0);assert.equal(f.toggle.textContent,'Play');
 f.prev.fire('click');assert.equal(f.position.textContent,'3 of 3');assert.equal(f.announcement.textContent,'Review 3 of 3');
 let prevented=false;f.viewport.fire('keydown',{key:'ArrowRight',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(f.position.textContent,'1 of 3');
 f.toggle.fire('click');assert.equal(f.timers.size,1);f.motion.fire('change');assert.equal(f.timers.size,0);
 assert.equal(fixture({count:1}).timers.size,0);assert.equal(fixture({count:0}).timers.size,0);
});
