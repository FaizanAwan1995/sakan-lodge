import {escapeHtml as h} from './public-routes.js';

const locations = {
  fulham: {
    name: 'Fulham',
    intro: 'Explore furnished rooms at Sakan Fulham in Adelaide’s western suburbs. Women-only living is being introduced here; ask our team when the household and your room will be ready. Compare room photos, occupancy and stay lengths before enquiring.',
    audience: '/accommodation/women/', audienceLabel: 'Women’s accommodation at Sakan Fulham',
  },
  clapham: {
    name: 'Clapham',
    intro: 'Compare furnished private rooms and shared accommodation at Sakan Clapham in Adelaide’s southern foothills. Explore men-only household options, view individual room details and check availability for your full stay.',
    audience: '/accommodation/men/', audienceLabel: 'Men’s accommodation in Adelaide',
  },
  'oaklands-park': {
    name: 'Oaklands Park',
    intro: 'Explore furnished rooms and shared accommodation at Sakan Oaklands Park in Adelaide’s southern suburbs. Compare men-only household options and individual room details, with Westfield Marion, Oaklands railway station and local recreation in the surrounding area.',
    audience: '/accommodation/men/', audienceLabel: 'Men’s accommodation in Adelaide',
  },
};
export function locationSearchContent(slug) {
  const location = locations[slug];
  if (!location) return null;
  const {name} = location;
  return {
    title: `Rooms for Rent in ${name}, Adelaide | Bills Included`,
    description: `Furnished rooms in ${name}, Adelaide. Shared long stays $185/person/week; private rooms from $255/week. Bills included. View rooms and enquire about your dates.`,
    intro: `<p>${h(location.intro)}</p>`,
    details: `<section class="catalog-card" aria-labelledby="stay-details"><h2 id="stay-details">Renting a room in ${h(name)}</h2><p>Shared rooms are $185 per person/week for stays of at least two calendar months. Private rooms for one occupant are $255/week long-term or $300/week short-term, subject to availability. Electricity, water, gas and internet are included. At Fulham, the property electricity allowance is $1,000 per three months; your agreement explains any excess allocation.</p><p>Check the room’s capacity, photos and amenities, then send your preferred move-in date, stay length and number of occupants. Our team confirms household arrangements, availability, bond and agreement details. An enquiry does not reserve a room.</p><p><a class="enquiry-next-action" href="/enquire?location=${encodeURIComponent(name)}">Enquire about ${h(name)}</a></p><p><a href="${location.audience}">${h(location.audienceLabel)}</a> · <a href="/student-accommodation-adelaide/">Compare student room costs and stay lengths</a></p></section>`,
  };
}
