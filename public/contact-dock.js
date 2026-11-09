/* Customer-controlled positioning. Only anonymous layout preferences are stored. */
export function clampDock(position,viewport,size,pad=12){
 const left=viewport.left||0,top=viewport.top||0;
 return {x:Math.max(left+pad,Math.min(position.x,left+Math.max(pad,viewport.width-size.width-pad))),y:Math.max(top+pad,Math.min(position.y,top+Math.max(pad,viewport.height-size.height-pad)))};
}
export function validDockPreference(value){return value&&['x','y'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])&&value[k]>=0&&value[k]<=1);}
if(typeof document!=='undefined'){
 const contact=document.getElementById('floating-contact');
 if(contact&&!document.getElementById('sakan-action-dock')){
  const key='sakan-contact-tools-position-v1';let preference=null,drag=null,suppressClick=false;
  try{const saved=JSON.parse(localStorage.getItem(key));if(validDockPreference(saved))preference=saved;}catch{}
  const css=document.createElement('link');css.rel='stylesheet';css.href='/contact-dock.css?v=20261109-1';document.head.append(css);
  const dock=document.createElement('div');dock.id='sakan-action-dock';dock.className='sakan-action-dock';dock.setAttribute('role','toolbar');dock.setAttribute('aria-label','Contact and AI room guide tools');
  const handle=document.createElement('button');handle.type='button';handle.className='contact-dock-handle';handle.setAttribute('aria-label','Move contact and chat tools');handle.setAttribute('aria-expanded','false');handle.setAttribute('aria-controls','contact-dock-settings');handle.title='Drag to move. Arrow keys move; Home resets. Tap for options.';handle.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v18M3 12h18m-6-6-3-3-3 3m6 12-3 3-3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/></svg>';
  const menu=document.createElement('div');menu.id='contact-dock-settings';menu.className='contact-dock-settings';menu.hidden=true;
  const help=document.createElement('p');help.textContent='Drag the move handle to place these tools anywhere. Use arrow keys to move, or Home to reset.';
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset position';menu.append(help,reset);
  const announcement=document.createElement('span');announcement.className='contact-dock-status';announcement.setAttribute('role','status');
  dock.append(handle,contact,menu,announcement);document.body.append(dock);document.body.classList.add('has-sakan-action-dock');
  const viewport=()=>({width:window.visualViewport?.width||innerWidth,height:(window.visualViewport?.height||innerHeight)-Math.max(0,(parseFloat(getComputedStyle(dock).getPropertyValue('--dock-safe-bottom'))||0)-12),left:window.visualViewport?.offsetLeft||0,top:window.visualViewport?.offsetTop||0});
  function place(p){const v=viewport(),r=dock.getBoundingClientRect(),n=clampDock(p,v,r);dock.style.left=n.x+'px';dock.style.top=n.y+'px';dock.dataset.panels=n.y-v.top<220?'below':'above';return n;}
  function layout(){if(drag)return;const v=viewport(),r=dock.getBoundingClientRect();place({x:(v.left||0)+12+(preference?.x??1)*Math.max(0,v.width-r.width-24),y:(v.top||0)+12+(preference?.y??1)*Math.max(0,v.height-r.height-24)});}
  function save(){const v=viewport(),r=dock.getBoundingClientRect();preference={x:Math.max(0,Math.min(1,(r.left-v.left-12)/Math.max(1,v.width-r.width-24))),y:Math.max(0,Math.min(1,(r.top-v.top-12)/Math.max(1,v.height-r.height-24)))};try{localStorage.setItem(key,JSON.stringify(preference));}catch{}}
  function resetPosition(){preference=null;try{localStorage.removeItem(key);}catch{}menu.hidden=true;handle.setAttribute('aria-expanded','false');layout();announcement.textContent='Contact tools returned to the bottom corner.';handle.focus();}
  reset.addEventListener('click',resetPosition);
  handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=dock.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false};handle.setPointerCapture(e.pointerId);});
  handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<6)return;drag.moved=true;menu.hidden=true;handle.setAttribute('aria-expanded','false');dock.classList.add('is-dragging');place({x:drag.left+dx,y:drag.top+dy});});
  const finish=e=>{if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved;drag=null;dock.classList.remove('is-dragging');if(moved){suppressClick=true;save();announcement.textContent='Contact tools moved. Position remembered on this device.';setTimeout(()=>suppressClick=false,0);}layout();};
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
  handle.addEventListener('click',()=>{if(suppressClick)return;menu.hidden=!menu.hidden;handle.setAttribute('aria-expanded',String(!menu.hidden));});
  handle.addEventListener('keydown',e=>{const shifts={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(e.key==='Home'){e.preventDefault();resetPosition();return;}if(shifts[e.key]){e.preventDefault();const r=dock.getBoundingClientRect(),[x,y]=shifts[e.key],step=e.shiftKey?40:12;place({x:r.left+x*step,y:r.top+y*step});save();announcement.textContent='Contact tools moved.';}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;handle.setAttribute('aria-expanded','false');}});
  document.addEventListener('pointerdown',e=>{if(!dock.contains(e.target)){menu.hidden=true;handle.setAttribute('aria-expanded','false');}});
  const forms=new Set(),visible=new Set();let observer;
  function visibility(){const focused=document.activeElement;const editing=focused?.matches('input,textarea,select,[contenteditable="true"]');dock.classList.toggle('is-form-active',visible.size>0||Boolean(editing));}
  if('IntersectionObserver'in window)observer=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting&&e.boundingClientRect.height>0)visible.add(e.target);else visible.delete(e.target);}visibility();});
  function attach(){const agent=document.querySelector('.room-guide-launch');if(agent&&agent.parentElement!==dock)dock.insertBefore(agent,menu);for(const f of document.querySelectorAll('form'))if(!f.closest('dialog')&&!forms.has(f)){forms.add(f);observer?.observe(f);}for(const f of forms)if(!f.isConnected){forms.delete(f);visible.delete(f);observer?.unobserve(f);}visibility();}
  new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('focusin',visibility);document.addEventListener('focusout',()=>setTimeout(visibility,0));
  window.addEventListener('resize',layout);window.visualViewport?.addEventListener('resize',layout);window.visualViewport?.addEventListener('scroll',layout);
  new ResizeObserver(layout).observe(dock);css.addEventListener('load',layout);attach();requestAnimationFrame(layout);
 }
}
