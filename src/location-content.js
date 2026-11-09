import {utilityPolicy} from './utility-policy.js';
import {escapeHtml as h} from './public-routes.js';

const locations = {
  fulham: {
    name: 'Fulham',
    intro: 'Explore furnished rooms at Sakan Fulham in Adelaide’s western suburbs. Female-only living is being introduced here; ask our team when the household and your room will be ready. The Fulham granny flat is available separately for couples at $500/week, bills included, from 11 November 2026. Compare photos and stay options before enquiring.',
    audience: '/accommodation/women/', audienceLabel: 'Female accommodation at Sakan Fulham',
  },
  clapham: {
    name: 'Clapham',
    intro: 'Compare furnished private rooms and shared accommodation at Sakan Clapham in Adelaide’s southern foothills. Explore male-only household options, view individual room details and check availability for your full stay.',
    audience: '/accommodation/men/', audienceLabel: 'Male accommodation in Adelaide',
  },
  'oaklands-park': {
    name: 'Oaklands Park',
    intro: 'Explore furnished rooms and shared accommodation at Sakan Oaklands Park in Adelaide’s southern suburbs. Compare male-only household options and individual room details, with Westfield Marion, Oaklands railway station and local recreation in the surrounding area.',
    audience: '/accommodation/men/', audienceLabel: 'Male accommodation in Adelaide',
  },
};
export function locationSearchContent(slug) {
  const location = locations[slug];
  if (!location) return null;
  const {name} = location;
  return {
    title: `Rooms for Rent in ${name}, Adelaide | Bills Included`,
    description: `Furnished rooms in ${name}, Adelaide. Shared long stays $185/person/week; private rooms from $255/week. Bills included. View rooms and enquire about your dates.`,
    intro: `<p>${h(location.intro)}</p>${slug==='fulham'?'<section class="catalog-card" aria-labelledby="fulham-couples"><h2 id="fulham-couples">Granny flat for rent in Fulham for couples</h2><p><strong>$500 per week for a couple, bills included.</strong> Available from <time datetime="2026-11-11">11 November 2026</time>. Bond: $1,000 (two weeks’ rent). Stays must be longer than three months. Street and garage parking are available. The flat has a separate entrance, with a kitchen and bathroom exclusively for the couple. Browse the photos and enquire about your move-in date.</p><p><a class="enquiry-next-action" href="/accommodation/couples/">View the Fulham granny flat and all photos</a> · <a href="/enquire?audience=couples&amp;location=Fulham">Enquire for two occupants</a></p></section>':''}`,
    details: `<section class="catalog-card" aria-labelledby="stay-details"><h2 id="stay-details">Renting a room in ${h(name)}</h2><p>Shared rooms are $185 per person/week for stays of at least two calendar months. Private rooms for one occupant are $255/week long-term or $300/week short-term, subject to availability. Electricity, water, gas and internet are included. ${h(utilityPolicy(slug))}</p><p>Check the room’s capacity, photos and amenities, then send your preferred move-in date, stay length and number of occupants. Our team confirms household arrangements, availability, bond and agreement details. An enquiry does not reserve a room.</p><p><a class="enquiry-next-action" href="/enquire?location=${encodeURIComponent(name)}">Enquire about ${h(name)}</a></p><p><a href="${location.audience}">${h(location.audienceLabel)}</a> · <a href="/student-accommodation-adelaide/">Compare student room costs and stay lengths</a></p></section>`,
  };
}
