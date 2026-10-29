(function(root){
 'use strict';
 const types={Transport:['bus_stop','bus_station','train_station','light_rail_station','transit_station'],Groceries:['supermarket','grocery_store'],Parks:['park','national_park']};
 // One SDK load per page, and one request per category per suburb per visit.
 // Session-only results are never persisted or shared between visitors.
 let sdkPromise,boundariesPromise;
 function loadBoundaries(){if(!boundariesPromise)boundariesPromise=deadline(root.fetch('/suburb-boundaries.geojson')).then(response=>{if(!response.ok)throw new Error('boundary');return response.json();}).catch(error=>{boundariesPromise=null;throw error;});return boundariesPromise;}
 function suburbBoundary(collection,name){return collection?.features?.find(feature=>feature.properties?.suburb===name.toUpperCase()&&feature.geometry?.type==='Polygon') || null;}
 function deadline(promise,ms=18000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=root.setTimeout(()=>reject(new Error('timeout')),ms);})]).finally(()=>root.clearTimeout(timer));}
 function loadGoogle(doc){
  if(sdkPromise)return sdkPromise;
  sdkPromise=(async()=>{
   const response=await deadline(root.fetch('/api/public/maps-config',{credentials:'same-origin',cache:'no-store'}));
   if(!response.ok)throw new Error('configuration');
   const config=await response.json();if(!/^AIza[\w-]{30,50}$/.test(config.key || ''))throw new Error('configuration');
   await deadline(new Promise((resolve,reject)=>{
    const script=doc.createElement('script');script.async=true;
    root.sakanMapsLoaded=()=>{delete root.sakanMapsLoaded;resolve();};
    root.gm_authFailure=()=>{doc.dispatchEvent(new root.Event('sakan-map-auth-error'));reject(new Error('authentication'));};
    script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key:config.key,v:'weekly',loading:'async',callback:'sakanMapsLoaded',language:'en',region:'AU'});
    script.onerror=()=>{script.remove();reject(new Error('connection'));};doc.head.appendChild(script);
   }));
   return {api:root.google.maps,properties:config.properties || {}};
  })().catch(error=>{sdkPromise=null;throw error;});return sdkPromise;
 }
 function createViewController(adapter){
  let sequence=0;const pending=new Map();
  async function request(view){
   if(!pending.has(view)){
    const task=Promise.resolve().then(()=>view==='CBD route'?adapter.route():adapter.nearby(view));pending.set(view,task);
    task.catch(()=>{if(pending.get(view)===task)pending.delete(view);});
   }return pending.get(view);
  }
  return {async select(view){
   if(view!=='Overview'&&view!=='CBD route'&&!types[view])return;
   const current=++sequence;adapter.loading(view);
   try{await adapter.load();if(current!==sequence)return;
    const data=view==='Overview'?null:await request(view);
    if(current!==sequence)return;adapter.paint(view,data);
   }catch(error){if(current===sequence)adapter.error(view,error);}
  }};
 }
 function initSuburbMaps(doc){
  const panels=[...doc.querySelectorAll('[data-suburb-map]')],visible=new Set(),controllers=[];
  const text=(tag,value)=>{const e=doc.createElement(tag);e.textContent=value;return e;};
  for(const panel of panels){
   if(panel.dataset.mapEnhanced)continue;panel.dataset.mapEnhanced='true';
   const canvas=panel.querySelector('[data-map-canvas]'),status=panel.querySelector('[data-map-status]'),results=panel.querySelector('[data-map-results]'),retry=panel.querySelector('[data-map-retry]'),buttons=[...panel.querySelectorAll('[data-map-view]')];
   if(!canvas)continue;
   const name=panel.dataset.suburbName,center=JSON.parse(panel.dataset.mapCenter),property=JSON.parse(panel.dataset.mapProperty);
   let origin;
   let api,map,info,initializing,boundaryPoints=[],overlays=[],lastView='Overview',failed=false;
   function setStatus(value){status.textContent=value;}
   function clear(){info?.close();for(const overlay of overlays)overlay.setMap(null);overlays=[];results.replaceChildren();}
   function boundsFor(points,maxZoom=16){const bounds=new api.LatLngBounds();bounds.extend(origin);for(const point of points)bounds.extend(point);map.fitBounds(bounds,36);api.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>maxZoom)map.setZoom(maxZoom);});}
   function showPlace(place){map.panTo(place.location);map.setZoom(16);const content=text('div','');content.append(text('strong',place.displayName || 'Nearby place'),text('p',place.formattedAddress || ''));info.setContent(content);info.setPosition(place.location);info.open({map,shouldFocus:false});}
   function markerRadius(point,pixels){return pixels*156543.03392*Math.cos(point.lat*Math.PI/180)/Math.pow(2,map.getZoom());}
   function dot(point,title,color='#173d32',pixels=8){const literal=typeof point.lat==='function'?{lat:point.lat(),lng:point.lng()}:point;const circle=new api.Circle({map,center:point,radius:markerRadius(literal,pixels),strokeColor:'#fff',strokeWeight:2,fillColor:color,fillOpacity:.95});circle.sakanMarker={point:literal,pixels};if(title)circle.addListener('click',()=>{info.setContent(text('strong',title));info.setPosition(point);info.open({map,shouldFocus:false});});overlays.push(circle);return circle;}
   async function load(){
    if(map)return;if(initializing)return initializing;
    initializing=(async()=>{
     const config=await loadGoogle(doc);api=config.api;origin=config.properties[panel.dataset.suburbMap];if(!origin)throw new Error('property-configuration');const {Map:GoogleMap,InfoWindow}=await api.importLibrary('maps');
     canvas.replaceChildren();
     map=new GoogleMap(canvas,{center,zoom:14,minZoom:10,maxZoom:18,mapTypeId:'hybrid',renderingType:'RASTER',gestureHandling:'greedy',tilt:0,streetViewControl:false,mapTypeControl:false,rotateControl:false,fullscreenControl:true,zoomControl:true,clickableIcons:false});
     info=new InfoWindow();
     // Keep the verified house pin independent of transient nearby/route overlays.
     class HousePin extends api.OverlayView {
      onAdd(){this.element=text('button',property.name);this.element.type='button';this.element.className='sakan-property-pin';this.element.setAttribute('aria-label',property.name+' property location');this.element.addEventListener('click',()=>{info.setContent(text('strong',property.name));info.setPosition(origin);info.open({map,shouldFocus:false});});this.getPanes().overlayMouseTarget.appendChild(this.element);api.OverlayView.preventMapHitsAndGesturesFrom(this.element);}
      draw(){const position=this.getProjection().fromLatLngToDivPixel(new api.LatLng(origin));if(position&&this.element){this.element.style.left=position.x+'px';this.element.style.top=position.y+'px';}}
      onRemove(){this.element?.remove();}
     }
     const housePin=new HousePin();housePin.setMap(map);

     // Boundary data is a small first-party asset, independent of Places/API quotas.
     void loadBoundaries().then(collection=>{
      const feature=suburbBoundary(collection,name);if(!feature)return;
      map.data.addGeoJson({type:'FeatureCollection',features:[feature]});
      map.data.setStyle({strokeColor:'#f6c85f',strokeOpacity:1,strokeWeight:3,fillColor:'#f6c85f',fillOpacity:.12,clickable:false,zIndex:1});
      boundaryPoints=feature.geometry.coordinates[0].map(([lng,lat])=>({lat,lng}));
      const legend=panel.querySelector('[data-map-boundary]');if(legend){legend.hidden=false;legend.textContent=`Gold outline: ${name} suburb`;}
      if(lastView==='Overview')boundsFor(boundaryPoints,14);
     }).catch(()=>{const legend=panel.querySelector('[data-map-boundary]');if(legend){legend.hidden=false;legend.textContent='Suburb outline unavailable. The map is still interactive.';}});

     map.addListener('zoom_changed',()=>{for(const overlay of overlays){const marker=overlay.sakanMarker;if(marker)overlay.setRadius(markerRadius(marker.point,marker.pixels));}});
     await deadline(new Promise(resolve=>api.event.addListenerOnce(map,'tilesloaded',resolve)));
    })().catch(error=>{map=null;initializing=null;throw error;});return initializing;
   }
   const controller=createViewController({load,
    loading(view){lastView=view;failed=false;retry.hidden=true;panel.setAttribute('aria-busy','true');buttons.forEach(b=>b.toggleAttribute('data-map-pending',b.dataset.mapView===view));setStatus(view==='Overview'?`Loading ${name} satellite map…`:`Finding ${view==='CBD route'?'a driving route to Adelaide CBD':view.toLowerCase()+' near '+name}…`);},
    async nearby(view){const {Place,SearchNearbyRankPreference}=await api.importLibrary('places');const response=await deadline(Place.searchNearby({fields:['displayName','location','formattedAddress','attributions'],locationRestriction:{center:origin,radius:2500},includedTypes:types[view],rankPreference:SearchNearbyRankPreference.DISTANCE,maxResultCount:6}));return response.places || [];},
    async route(){const {Route}=await api.importLibrary('routes');const response=await deadline(Route.computeRoutes({origin,destination:{lat:-34.9285,lng:138.6007},travelMode:'DRIVING',fields:['path','distanceMeters','durationMillis','warnings']}));if(!response.routes?.length)throw new Error('no-route');return response.routes[0];},
    paint(view,data){
     clear();panel.removeAttribute('aria-busy');buttons.forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.mapView===view));b.removeAttribute('data-map-pending');});

     if(view==='Overview'){if(boundaryPoints.length)boundsFor(boundaryPoints,14);else{map.setCenter(center);map.setZoom(14);}setStatus(`Explore ${name} in satellite view.`);return;}
     if(view==='CBD route'){
      for(const line of data.createPolylines({polylineOptions:{strokeColor:'#2769c9',strokeOpacity:1,strokeWeight:5}})){line.setMap(map);overlays.push(line);}
      boundsFor(data.path || []);dot({lat:-34.9285,lng:138.6007},'Adelaide CBD','#2769c9',10);
      const km=(data.distanceMeters/1000).toFixed(1),minutes=Math.round(data.durationMillis/60000);
      setStatus(`Driving to Adelaide CBD: ${km} km · approximately ${minutes} min.`);results.append(text('p','Indicative driving route from the marked house. Travel time varies; this is not a public transport timetable.'));
      for(const warning of data.warnings || [])results.append(text('p',warning));return;
     }
     const places=data.filter(p=>p.location);setStatus(places.length?`${places.length} ${view.toLowerCase()} places near ${name}. Tap a place to locate it.`:`No ${view.toLowerCase()} places found within 2.5 km. Try another category.`);
     if(!places.length){map.setCenter(center);map.setZoom(14);return;}
     boundsFor(places.map(p=>p.location));const list=doc.createElement('ul');
     for(const place of places){const circle=dot(place.location,place.displayName);circle.addListener('click',()=>showPlace(place));const item=doc.createElement('li'),button=text('button',place.displayName || 'Nearby place');button.type='button';button.addEventListener('click',()=>showPlace(place));item.append(button,text('small',place.formattedAddress || ''));
      for(const attribution of place.attributions || []){const note=text('small',''),label=text('a',attribution.provider || '');if(/^https:\/\//.test(attribution.providerURI || '')){label.href=attribution.providerURI;label.target='_blank';label.rel='noopener noreferrer';}note.append(label);if(label.textContent)item.append(note);}list.append(item);
     }results.append(list);
    },
    error(view){failed=true;panel.removeAttribute('aria-busy');buttons.forEach(b=>b.removeAttribute('data-map-pending'));retry.hidden=false;setStatus(map?`Couldn’t load ${view.toLowerCase()}. Your map is still available. Try again.`:'The map couldn’t load. Check your connection and try again.');}
   });
   for(const button of buttons)button.addEventListener('click',()=>{void controller.select(button.dataset.mapView);});
   panel.querySelector('[data-map-property-focus]')?.addEventListener('click',()=>{void load().then(()=>{map.panTo(origin);map.setZoom(16);info.setContent(text('strong',property.name));info.setPosition(origin);info.open({map,shouldFocus:false});}).catch(()=>controller.select('Overview'));});
   retry.addEventListener('click',()=>{void controller.select(lastView);});
   doc.addEventListener('sakan-map-auth-error',()=>{failed=true;setStatus('The map is temporarily unavailable. Please try again later.');retry.hidden=false;});
   if(root.IntersectionObserver){const observer=new root.IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){visible.add(panel);if(!initializing&&!failed)void controller.select('Overview');}else visible.delete(panel);}doc.body?.classList.toggle('suburb-map-in-view',visible.size>0);},{threshold:.05});observer.observe(panel);}else void controller.select('Overview');
   controllers.push(controller);
  }return controllers;
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={initSuburbMaps,createViewController,suburbBoundary};
 root.initSakanSuburbMaps=initSuburbMaps;
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>initSuburbMaps(root.document),{once:true});else initSuburbMaps(root.document);}
})(typeof window!=='undefined'?window:globalThis);
