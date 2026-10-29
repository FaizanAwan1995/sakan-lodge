import {escapeHtml as h} from './public-routes.js';

const suburbs={
 fulham:{name:'Fulham',area:'Adelaide’s western suburbs',eyebrow:'Coast & city connections',highlights:'Henley Beach area · River Torrens trails'},
 clapham:{name:'Clapham',area:'Adelaide’s inner south',eyebrow:'Foothills & local life',highlights:'Belair rail line · Surrounding woodland trails'},
 'oaklands-park':{name:'Oaklands Park',area:'Adelaide’s southern suburbs',eyebrow:'Shopping, rail & recreation',highlights:'Westfield Marion · Oaklands rail connections'},
};
const embedded=params=>'https://maps.google.com/maps?'+new URLSearchParams({...params,t:'k',output:'embed',hl:'en'});
export function suburbMapLinks(slug){
 const g=suburbs[slug];if(!g)return null;
 const place=`${g.name}, South Australia, Australia`;
 const embed=embedded({q:place,z:'12'});
 return {name:g.name,embed,directions:embedded({saddr:place,daddr:'Adelaide CBD, South Australia, Australia'}),nearby:[['Transport',embedded({q:`public transport near ${place}`,z:'13'})],['Groceries',embedded({q:`supermarkets near ${place}`,z:'13'})],['Parks',embedded({q:`parks near ${place}`,z:'13'})]]};
}
export function renderSuburbMap(slug){
 const m=suburbMapLinks(slug);if(!m)return '';
 const id=`suburb-map-${slug}`;
 const views=[['Overview',m.embed],...m.nearby,['CBD route',m.directions]];
 return `<div class="suburb-map" data-suburb-map="${h(slug)}" data-suburb-name="${h(m.name)}"><div class="suburb-map-toolbar"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>Interactive satellite map</span><span class="suburb-map-live">Zoom &amp; explore</span></div><div class="suburb-map-window"><iframe id="${id}" name="${id}" title="Interactive satellite map of ${h(m.name)}, South Australia" src="${h(m.embed)}" width="600" height="340" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><p class="suburb-map-help" data-map-help>Pinch to zoom and use two fingers to move on mobile. Drag with a mouse on desktop.</p><nav class="suburb-map-actions" aria-label="Explore ${h(m.name)} on this map">${views.map(([label,url],i)=>`<a href="${h(url)}" target="${id}" data-map-view="${h(label)}" aria-controls="${id}"${i===0?' aria-current="true"':''}>${h(label)}</a>`).join('')}</nav><p class="suburb-map-status" data-map-status role="status">Showing ${h(m.name)} satellite overview.</p><p class="suburb-map-note">These options update the map here. Suburb overview, not a property address. CBD routes start from the suburb centre.</p></div>`;
}
export function renderSuburbLocationCards(){
 return Object.entries(suburbs).map(([slug,g])=>`<article class="location-card"><header class="location-heading"><span class="location-kicker">${h(g.eyebrow)}</span><h3>${h(g.name)}</h3><p>${h(g.area)}</p></header>${renderSuburbMap(slug)}<div class="location-body"><p class="location-highlights">${h(g.highlights)}</p><a class="location-cta" href="/locations/${slug}/" aria-label="View rooms and availability in ${h(g.name)}">View ${h(g.name)} rooms &amp; availability <span aria-hidden="true">↗</span></a></div></article>`).join('');
}
