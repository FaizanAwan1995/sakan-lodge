(function(root){
 'use strict';
 function initSuburbMaps(doc){
  const maps=[];
  for(const panel of doc.querySelectorAll('[data-suburb-map]')){
   if(panel.dataset.mapEnhanced)continue;
   panel.dataset.mapEnhanced='true';
   const frame=panel.querySelector('iframe'),toggle=panel.querySelector('[data-map-toggle]'),help=panel.querySelector('[data-map-help]'),loading=panel.querySelector('[data-map-loading]');
   if(!frame||!toggle)continue;
   const inactive='Select Explore map to zoom and drag. Scroll normally to browse rooms.';
   let timer;
   function deactivate(focus=false){panel.dataset.mapActive='false';frame.tabIndex=-1;frame.setAttribute('inert','');frame.setAttribute('aria-hidden','true');toggle.setAttribute('aria-pressed','false');toggle.textContent='Explore map';help.textContent=inactive;if(focus)toggle.focus();}
   function ready(){if(timer)root.clearTimeout(timer);if(loading)loading.hidden=true;panel.dataset.mapLoaded='true';}
   toggle.hidden=false;deactivate();
   toggle.addEventListener('click',()=>{
    if(panel.dataset.mapActive==='true'){deactivate();return;}
    for(const other of maps)other.deactivate();
    panel.dataset.mapActive='true';frame.tabIndex=0;frame.removeAttribute('inert');frame.removeAttribute('aria-hidden');toggle.setAttribute('aria-pressed','true');toggle.textContent='Back to page';help.textContent='Map active — zoom, drag or explore place labels. Select Back to page to continue scrolling.';
   });
   panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel.dataset.mapActive==='true'){event.preventDefault();deactivate(true);}});
   frame.addEventListener('load',ready);
   frame.addEventListener('error',()=>{ready();help.textContent='Map unavailable here. Use Open Google Maps below to explore this suburb.';});
   // A lazy frame can remain outside the viewport; avoid suggesting a network error prematurely.
   const startLoading=()=>{if(panel.dataset.mapLoaded==='true')return;if(loading)loading.hidden=false;timer=root.setTimeout(()=>{if(loading)loading.hidden=true;if(panel.dataset.mapActive!=='true')help.textContent='Taking a little longer? You can still open Google Maps below.';},12000);};
   if(root.IntersectionObserver){const observer=new root.IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){startLoading();observer.disconnect();}},{rootMargin:'100px'});observer.observe(panel);}else startLoading();
   maps.push({deactivate});
  }
  return maps;
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={initSuburbMaps};
 root.initSakanSuburbMaps=initSuburbMaps;
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>initSuburbMaps(root.document),{once:true});else initSuburbMaps(root.document);}
})(typeof window!=='undefined'?window:globalThis);
