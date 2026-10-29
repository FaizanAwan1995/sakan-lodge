(function(root){
 'use strict';
 function initSuburbMaps(doc){
  const maps=[],visible=new Set();
  function syncContacts(){doc.body?.classList.toggle('suburb-map-in-view',visible.size>0);}
  for(const panel of doc.querySelectorAll('[data-suburb-map]')){
   if(panel.dataset.mapEnhanced)continue;
   panel.dataset.mapEnhanced='true';
   const frame=panel.querySelector('iframe'),status=panel.querySelector('[data-map-status]'),links=[...panel.querySelectorAll('[data-map-view]')];
   if(!frame)continue;
   // The iframe is interactive immediately. Never put inert, pointer blocking,
   // or a touch-catching overlay over Google's own gesture controls.
   frame.removeAttribute('inert');frame.removeAttribute('aria-hidden');frame.tabIndex=0;
   const name=panel.dataset.suburbName || 'this suburb';
   for(const link of links)link.addEventListener('click',event=>{
    const src=link.getAttribute('href');
    if(!src || !/^https:\/\/maps\.google\.com\/maps\?/.test(src))return;
    event.preventDefault();
    for(const other of links)other.removeAttribute('aria-current');
    link.setAttribute('aria-current','true');
    frame.title=`${link.dataset.mapView} — ${name}, South Australia`;
    frame.setAttribute('src',src);
    if(status)status.textContent=link.dataset.mapView==='Overview'?`Showing ${name} satellite overview.`:`Showing ${link.dataset.mapView.toLowerCase()} for ${name} in this map.`;
   });
   // Keep floating WhatsApp/Messenger/enquiry controls clear of map gestures and controls.
   if(root.IntersectionObserver){
    const observer=new root.IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visible.add(panel);else visible.delete(panel);}syncContacts();},{threshold:0});
    observer.observe(panel);
   }
   maps.push({panel,frame});
  }
  return maps;
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={initSuburbMaps};
 root.initSakanSuburbMaps=initSuburbMaps;
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>initSuburbMaps(root.document),{once:true});else initSuburbMaps(root.document);}
})(typeof window!=='undefined'?window:globalThis);
