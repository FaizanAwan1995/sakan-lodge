import {escapeHtml as h} from './public-routes.js';

const suburbs={
 fulham:{name:'Fulham',area:'Adelaide’s western suburbs',eyebrow:'Coast & city connections',highlights:'Henley Beach area · River Torrens trails'},
 clapham:{name:'Clapham',area:'Adelaide’s inner south',eyebrow:'Foothills & local life',highlights:'Belair rail line · Surrounding woodland trails'},
 'oaklands-park':{name:'Oaklands Park',area:'Adelaide’s southern suburbs',eyebrow:'Shopping, rail & recreation',highlights:'Westfield Marion · Oaklands rail connections'},
};
const search=query=>'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query});
export function suburbMapLinks(slug){
 const g=suburbs[slug];if(!g)return null;
 const place=`${g.name}, South Australia, Australia`;
 return {name:g.name,embed:'https://maps.google.com/maps?'+new URLSearchParams({q:place,z:'11',t:'m',output:'embed',hl:'en'}),open:search(place),directions:'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:place,destination:'Adelaide CBD, South Australia, Australia'}),nearby:[['Transport',search(`public transport near ${place}`)],['Groceries',search(`supermarkets near ${place}`)],['Parks',search(`parks near ${place}`)]]};
}
export function renderSuburbMap(slug){
 const m=suburbMapLinks(slug);if(!m)return '';
 const id=`suburb-map-${slug}`;
 return `<div class="suburb-map" data-suburb-map="${h(slug)}"><div class="suburb-map-toolbar"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>Explore ${h(m.name)}</span><button type="button" class="suburb-map-toggle" data-map-toggle aria-controls="${id}" aria-pressed="false" hidden>Explore map</button></div><div class="suburb-map-window"><iframe id="${id}" title="Interactive Google Map of ${h(m.name)}, South Australia" src="${h(m.embed)}" width="600" height="300" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><div class="suburb-map-loading" data-map-loading hidden>Loading Google Maps…</div></div><p class="suburb-map-help" data-map-help aria-live="polite">Zoom to compare the suburb with Adelaide CBD. Open Google Maps for current routes and nearby facilities.</p><div class="suburb-map-links"><a href="${h(m.open)}" target="_blank" rel="noopener noreferrer">Open Google Maps <span aria-hidden="true">↗</span></a><a href="${h(m.directions)}" target="_blank" rel="noopener noreferrer">Route to Adelaide CBD <span aria-hidden="true">↗</span></a></div><nav class="suburb-map-nearby" aria-label="Explore nearby facilities in ${h(m.name)}">${m.nearby.map(([label,url])=>`<a href="${h(url)}" target="_blank" rel="noopener noreferrer" aria-label="Find ${label.toLowerCase()} near ${h(m.name)} on Google Maps">${label}<span aria-hidden="true">↗</span></a>`).join('')}</nav><p class="suburb-map-note">Suburb overview, not a property address. Directions start from the suburb centre.</p></div>`;
}
export function renderSuburbLocationCards(){
 return Object.entries(suburbs).map(([slug,g])=>`<article class="location-card">${renderSuburbMap(slug)}<div class="location-body"><span class="location-kicker">${h(g.eyebrow)}</span><h3>${h(g.name)}</h3><p>${h(g.area)}</p><p class="location-highlights">${h(g.highlights)}</p><a class="location-cta" href="/locations/${slug}/" aria-label="View rooms and availability in ${h(g.name)}">View ${h(g.name)} rooms &amp; availability <span aria-hidden="true">↗</span></a></div></article>`).join('');
}
