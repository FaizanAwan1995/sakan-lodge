import {escapeHtml as h} from './public-routes.js';

const suburbs={
 fulham:{name:'Fulham',property:{name:'Sakan Fulham'},center:{lat:-34.928296,lng:138.511307},area:'Adelaide’s western suburbs',eyebrow:'Coast & city connections',highlights:'Henley Beach area · River Torrens trails'},
 clapham:{name:'Clapham',property:{name:'Sakan Clapham'},center:{lat:-34.992081,lng:138.606741},area:'Adelaide’s inner south',eyebrow:'Foothills & local life',highlights:'Belair rail line · Surrounding woodland trails'},
 'oaklands-park':{name:'Oaklands Park',property:{name:'Sakan Oaklands Park'},center:{lat:-35.008239,lng:138.544382},area:'Adelaide’s southern suburbs',eyebrow:'Shopping, rail & recreation',highlights:'Westfield Marion · Oaklands rail connections'},
};
const embedded=params=>'https://maps.google.com/maps?'+new URLSearchParams({...params,t:'k',output:'embed',hl:'en'});
export function suburbMapLinks(slug){
 const g=suburbs[slug];if(!g)return null;
 const place=`${g.name}, South Australia, Australia`;
 const embed=embedded({q:place,z:'14'});
 return {name:g.name,center:g.center,property:g.property,embed,directions:embedded({saddr:place,daddr:'Adelaide CBD, South Australia, Australia'}),nearby:[['Transport',embedded({q:`public transport near ${place}`,z:'13'})],['Groceries',embedded({q:`supermarkets near ${place}`,z:'13'})],['Parks',embedded({q:`parks near ${place}`,z:'13'})]]};
}
export function renderSuburbMap(slug){
 const m=suburbMapLinks(slug);if(!m)return '';
 const id=`suburb-map-${slug}`;
 const views=[['Overview',m.embed],...m.nearby,['CBD route',m.directions]];
 return `<div class="suburb-map" data-suburb-map="${h(slug)}" data-suburb-name="${h(m.name)}" data-map-center="${h(JSON.stringify(m.center))}" data-map-property="${h(JSON.stringify(m.property))}">
<div class="suburb-map-toolbar"><span>Satellite map</span><span class="suburb-map-live">Drag &amp; zoom</span></div>
<div class="suburb-map-window" id="${id}" data-map-canvas role="region" aria-label="Interactive satellite map of ${h(m.name)}, South Australia"><span class="suburb-map-placeholder">Loading satellite map…</span></div>
<div class="suburb-map-controls"><button class="suburb-map-property" type="button" data-map-property-focus aria-label="Locate ${h(m.property.name)}">Locate house</button><button class="suburb-map-toggle" type="button" data-map-tools-toggle aria-expanded="false" aria-controls="${id}-tools" aria-label="Explore area around ${h(m.name)}">Explore area<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>
<div class="suburb-map-tools" id="${id}-tools" data-map-tools hidden>
<nav class="suburb-map-actions" aria-label="Explore ${h(m.name)} on this map">${views.map(([label])=>`<button type="button" data-map-view="${h(label)}" aria-controls="${id}" aria-pressed="false">${h(label)}</button>`).join('')}</nav>
<p class="suburb-map-status" data-map-status role="status">Map loads when it comes into view.</p><button type="button" class="suburb-map-retry" data-map-retry hidden>Try again</button><div class="suburb-map-results" data-map-results></div>
<details class="suburb-map-info"><summary>Map information</summary><p class="suburb-map-boundary" data-map-boundary hidden></p><p class="suburb-map-help">Pinch to zoom or drag the map. Select a nearby place to locate it.</p><p class="suburb-map-note">Property pins show house names only. Nearby places and CBD routes start from the marked house. Results provided by Google Maps. <a href="https://data.sa.gov.au/data/dataset/suburb-boundaries" target="_blank" rel="noopener noreferrer">Suburb boundaries: Government of South Australia</a>.</p></details>
</div><noscript><p class="suburb-map-note">Enable JavaScript to explore this map.</p></noscript></div>`;
}
export function renderSuburbLocationCards(){
 return Object.entries(suburbs).map(([slug,g])=>`<article class="location-card"><header class="location-heading"><span class="location-kicker">${h(g.eyebrow)}</span><h3>${h(g.name)}</h3><p>${h(g.area)}</p></header>${renderSuburbMap(slug)}<div class="location-body"><p class="location-highlights">${h(g.highlights)}</p><a class="location-cta" href="/locations/${slug}/" aria-label="View rooms and availability in ${h(g.name)}">View ${h(g.name)} rooms &amp; availability <span aria-hidden="true">↗</span></a></div></article>`).join('');
}
