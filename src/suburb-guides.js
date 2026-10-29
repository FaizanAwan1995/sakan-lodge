import { renderSuburbMap } from './suburb-maps.js';
import { escapeHtml as h } from './public-routes.js';

// Area-level information, checked against the linked operators/councils on
// 18 October 2026. These are not property amenities or distance guarantees.
export const SUBURB_GUIDES = {
  fulham: {
    name: 'Fulham', image: '/suburbs/fulham-map.webp', width: 800, height: 1056,
    eyebrow: 'Coast & city connections',
    intro: 'Get to know Adelaide’s western suburbs, with the Henley Beach coastline, River Torrens trails and everyday shopping in the surrounding area.',
    features: [
      { icon: 'coast', category: 'Beach & coast', title: 'Henley Beach & Henley Square', text: 'Explore the foreshore, jetty and seaside square in neighbouring Henley Beach.', href: 'https://www.henleysquarepavilion.com.au/come-visit/', link: 'Explore Henley Beach' },
      { icon: 'tree', category: 'Walking & cycling', title: 'River Torrens Linear Park', text: 'The river corridor offers walking and cycling routes through the western suburbs towards the coast.', href: 'https://www.charlessturt.sa.gov.au/community/sports-and-recreation/parks-reserves-and-playgrounds/george-jones-reserve', link: 'Explore the river corridor' },
      { icon: 'shop', category: 'Shopping & food', title: 'Henley Square Pavilion', text: 'A local-area option for groceries, cafés and specialty shopping at Henley Beach.', href: 'https://www.henleysquarepavilion.com.au/', link: 'View shops & facilities' },
      { icon: 'plane', category: 'Airport connections', title: 'Adelaide Airport', text: 'The airport is part of Adelaide’s western suburbs. Plan your terminal journey using the airport’s transport information.', href: 'https://adelaideairport.com.au/departures/', link: 'Plan an airport journey' },
    ],
  },
  clapham: {
    name: 'Clapham', image: '/suburbs/clapham-map.webp', width: 800, height: 1208,
    eyebrow: 'Foothills & local life',
    intro: 'Discover the southern foothills around Clapham, with rail connections, woodland trails and shopping in the surrounding Mitcham area.',
    features: [
      { icon: 'train', category: 'Public transport', title: 'Belair rail line', text: 'Lynton and Torrens Park stations are on the Belair line to the city. Check the best station and service for your journey.', href: 'https://www.adelaidemetro.com.au/routes/bel', link: 'View route & stations' },
      { icon: 'tree', category: 'Parks & trails', title: 'Lynton & Sleeps Hill reserves', text: 'Explore the council trail network through woodland and former quarry landscapes in the foothills.', href: 'https://www.mitchamcouncil.sa.gov.au/Learn-and-explore/walks-tours-and-trails', link: 'View trail information' },
      { icon: 'shop', category: 'Shopping & food', title: 'Mitcham Square', text: 'Supermarkets, cafés and everyday shops in nearby Torrens Park.', href: 'https://mitchamsquare.com.au/retail-directory/', link: 'View shop directory' },
      { icon: 'garden', category: 'Gardens & culture', title: 'Carrick Hill', text: 'Discover gardens, art and heritage in Springfield, in the wider foothills area.', href: 'https://www.carrickhill.sa.gov.au/discover', link: 'Plan a visit' },
    ],
  },
  'oaklands-park': {
    name: 'Oaklands Park', image: '/suburbs/oaklands-park-map.webp', width: 800, height: 1080,
    eyebrow: 'Shopping, rail & recreation',
    intro: 'Oaklands Park brings together southern-suburbs rail connections, major shopping and recreation, with wetlands and open space to explore.',
    features: [
      { icon: 'train', category: 'Public transport', title: 'Oaklands railway station', text: 'Seaford line trains link Oaklands with Adelaide and the southern suburbs. Check current services before travelling.', href: 'https://www.adelaidemetro.com.au/routes/SEAFRD', link: 'View route & stations' },
      { icon: 'shop', category: 'Shopping & food', title: 'Westfield Marion', text: 'Shopping, supermarkets and dining in Oaklands Park, with the Marion bus interchange serving the centre.', href: 'https://www.westfield.com.au/marion/service/2z8TlFOF8okmmY4o4uIwkA/getting-here', link: 'View centre & transport' },
      { icon: 'swim', category: 'Swimming & fitness', title: 'SA Aquatic & Leisure Centre', text: 'A swimming and leisure facility on Morphett Road in Oaklands Park. Check sessions and entry information with the operator.', href: 'https://saaquatic.ymca.org.au/location', link: 'View centre information' },
      { icon: 'tree', category: 'Nature & open space', title: 'Oaklands Wetland', text: 'Wetland habitat and open space with local wildlife, including birds and aquatic life.', href: 'https://southaustralia.com/products/adelaide/attraction/oaklands-wetland', link: 'Explore the wetland' },
    ],
  },
};
const paths = {
  coast: '<path d="M3 16c2-3 4 3 6 0s4 3 6 0 4 3 6 0M3 21c2-3 4 3 6 0s4 3 6 0 4 3 6 0"/><circle cx="16" cy="6" r="3"/><path d="M3 12h7"/>',
  tree: '<path d="m12 2-7 9h4l-5 6h7v5h2v-5h7l-5-6h4Z"/>',
  shop: '<path d="M3 10h18l-2-7H5l-2 7Zm2 0v11h14V10M9 21v-7h6v7M3 10c0 4 4 4 5 0 1 4 7 4 8 0 1 4 5 4 5 0"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4L22 2ZM11 13l5-5"/>',
  train: '<rect x="5" y="2" width="14" height="17" rx="4"/><path d="M5 10h14M12 2v8m-4 9-3 3m11-3 3 3"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',
  garden: '<path d="M12 22V10M12 15C4 15 3 9 3 7c7 0 9 3 9 8Zm0-4c0-7 5-9 9-9 0 7-3 10-9 9Z"/>',
  swim: '<path d="m3 17 3-1 3 1 3-1 3 1 3-1 3 1M3 22l3-1 3 1 3-1 3 1 3-1 3 1M6 12l5-5 5 5M11 7l5-3"/><circle cx="19" cy="6" r="2"/>',
};
function icon(type) { return '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths[type]+'</svg>'; }
export function renderSuburbGuide(slug) {
  const g=SUBURB_GUIDES[slug]; if(!g)return '';
  return '<section class="suburb-guide" aria-labelledby="area-heading"><p class="area-eyebrow">'+h(g.eyebrow)+'</p><h2 id="area-heading">Life around '+h(g.name)+'</h2><p class="area-intro">'+h(g.intro)+'</p><div class="area-layout"><div class="area-map area-map-live">'+renderSuburbMap(slug)+'</div><ul class="area-features">'+g.features.map(f=>'<li><span class="area-icon">'+icon(f.icon)+'</span><div><p class="area-category">'+h(f.category)+'</p><h3>'+h(f.title)+'</h3><p>'+h(f.text)+'</p><a href="'+h(f.href)+'" rel="noopener noreferrer">'+h(f.link)+' <span aria-hidden="true">↗</span></a></div></li>').join('')+'</ul></div><p class="area-note">These highlights cover the suburb and surrounding area. Check your route from the property and the operator’s current opening hours. Facilities are independently operated.</p></section>';
}
