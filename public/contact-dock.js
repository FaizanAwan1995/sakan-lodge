/* Customer-controlled positioning. Only anonymous layout preferences are stored. */
export function clampDock(position,viewport,size,pad=12){
 const left=viewport.left||0,top=viewport.top||0;
 return {x:Math.max(left+pad,Math.min(position.x,left+Math.max(pad,viewport.width-size.width-pad))),y:Math.max(top+pad,Math.min(position.y,top+Math.max(pad,viewport.height-size.height-pad)))};
}
export function validDockPreference(value){return value&&['x','y'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])&&value[k]>=0&&value[k]<=1);}
if(typeof document!=='undefined'){
 const css=document.createElement('link');css.rel='stylesheet';css.href='/contact-dock.css?v=20261109-2';document.head.append(css);
 const widgets=new Map(),prefix='sakan-floating-position-v2:';
 const viewport=()=>({width:window.visualViewport?.width||innerWidth,height:(window.visualViewport?.height||innerHeight)-Math.max(0,(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--floating-safe-bottom'))||0)-12),left:window.visualViewport?.offsetLeft||0,top:window.visualViewport?.offsetTop||0});
 function attach(element,key,defaultX){
  if(!element||widgets.has(key))return;
  let preference=null,drag=null,suppress=false;
  try{const saved=JSON.parse(localStorage.getItem(prefix+key));if(validDockPreference(saved))preference=saved;}catch{}
  element.classList.add('movable-contact');
  const status=document.createElement('span');status.className='floating-position-status';status.setAttribute('role','status');document.body.append(status);
  function place(position){const n=clampDock(position,viewport(),element.getBoundingClientRect());element.style.setProperty('left',n.x+'px','important');element.style.setProperty('top',n.y+'px','important');return n;}
  function layout(){if(drag)return;const v=viewport(),r=element.getBoundingClientRect();place({x:v.left+12+(preference?.x??defaultX)*Math.max(0,v.width-r.width-24),y:v.top+12+(preference?.y??1)*Math.max(0,v.height-r.height-24)});}
  function save(){const v=viewport(),r=element.getBoundingClientRect();preference={x:Math.max(0,Math.min(1,(r.left-v.left-12)/Math.max(1,v.width-r.width-24))),y:Math.max(0,Math.min(1,(r.top-v.top-12)/Math.max(1,v.height-r.height-24)))};try{localStorage.setItem(prefix+key,JSON.stringify(preference));}catch{}}
  function reset(){preference=null;try{localStorage.removeItem(prefix+key);}catch{}layout();status.textContent='Button returned to its bottom corner.';}
  element.title=(element.title?element.title+'. ':'')+'Drag to move. Alt + arrow keys move; Home resets.';
  element.addEventListener('dragstart',e=>e.preventDefault());
  element.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=element.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false};});
  window.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<7)return;if(!drag.moved){drag.moved=true;element.setPointerCapture(e.pointerId);}element.classList.add('is-moving');place({x:drag.left+dx,y:drag.top+dy});});
  const finish=e=>{if(!drag||drag.id!==e.pointerId)return;const moved=drag.moved;drag=null;element.classList.remove('is-moving');if(moved){suppress=true;save();status.textContent='Button position saved on this device.';setTimeout(()=>suppress=false,0);}layout();};
  window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
  element.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();}},true);
  element.addEventListener('contextmenu',e=>e.preventDefault());
  element.addEventListener('keydown',e=>{if(e.key==='Home'){e.preventDefault();reset();return;}const d={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[e.key];if(e.altKey&&d){e.preventDefault();const r=element.getBoundingClientRect();place({x:r.left+d[0],y:r.top+d[1]});save();}});
  window.addEventListener('resize',layout);window.visualViewport?.addEventListener('resize',layout);window.visualViewport?.addEventListener('scroll',layout);new ResizeObserver(layout).observe(element);css.addEventListener('load',layout);widgets.set(key,{reset});requestAnimationFrame(layout);
 }
 const visible=new Set(),forms=new Set();
 const update=()=>document.body.classList.toggle('floating-tools-hidden',visible.size>0||Boolean(document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')));
 const io=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting&&e.boundingClientRect.height>0)visible.add(e.target);else visible.delete(e.target);update();});
 function mount(){attach(document.getElementById('floating-contact'),'contact',0);attach(document.querySelector('.room-guide-launch'),'agent',1);
  const palette=document.getElementById('contact-palette');if(palette&&!document.getElementById('reset-floating-position')){const b=document.createElement('button');b.id='reset-floating-position';b.type='button';b.title='Reset both button positions';b.setAttribute('aria-label','Reset both button positions');b.textContent='↺';b.addEventListener('click',()=>{for(const w of widgets.values())w.reset();});palette.append(b);}
  for(const form of document.querySelectorAll('form'))if(!form.closest('dialog')&&!forms.has(form)){forms.add(form);io.observe(form);}for(const f of forms)if(!f.isConnected){forms.delete(f);visible.delete(f);io.unobserve(f);}update();
 }
 new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});document.addEventListener('focusin',update);document.addEventListener('focusout',()=>setTimeout(update,0));mount();
}
