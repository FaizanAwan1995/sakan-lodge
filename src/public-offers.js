/* Public marketing facts only. Booking and ledger pricing remain authoritative. */
export const PUBLIC_RATES = Object.freeze({ shared: 185, private: 255, short: 300, couples: 500, couplesBond: 1000 });
export const COUPLES_FAQ = `Yes. Our couples option is the separate Fulham granny flat at $${PUBLIC_RATES.couples} per couple per week, with bills included. It has its own kitchen, bathroom and entrance. The bond is $${PUBLIC_RATES.couplesBond.toLocaleString('en-AU')} and stays must be longer than three months. Advertised from 11 November 2026; our team confirms availability for your dates. Single-occupancy private rooms are for one person.`;
export function roomRateSummary(capacity, {card = false} = {}) {
  return capacity > 1
    ? `${card ? 'Shared accommodation' : 'Shared room'} · $${PUBLIC_RATES.shared}${card ? '/person' : ' per person'}/week · long-term only`
    : `Private room · $${PUBLIC_RATES.private}/week long-term · $${PUBLIC_RATES.short}/week short-term`;
}
export const PUBLIC_RATE_FACTS = `Shared rooms $${PUBLIC_RATES.shared} per person/week long-term only. Private rooms for one $${PUBLIC_RATES.private}/week long-term or $${PUBLIC_RATES.short}/week short-term.`;
export function renderPublicRates() {
  const offers = [
    {key:'shared', title:'Shared room', term:'Long-term', unit:'per person / week', description:'A budget-friendly place to settle in. For stays of two calendar months or longer.', label:'Enquire about shared rooms'},
    {key:'private', title:'Private room', term:'Long-term', unit:'per week', description:'Your own furnished space. For stays of two calendar months or longer.', label:'Enquire about private rooms', style:' featured'},
    {key:'short', title:'Private room', term:'Short-term', unit:'per week', description:'Extra flexibility for stays shorter than two calendar months. Ask us about nightly stays.', label:'Ask about shorter stays'},
    {key:'couples', title:'Fulham granny flat', term:'Couples', unit:'per couple / week', description:`Private kitchen, bathroom and entrance. Bond $${PUBLIC_RATES.couplesBond.toLocaleString('en-AU')} · Stay longer than three months. Advertised from 11 November 2026; team confirms availability.`, label:'Explore the granny flat', style:' rate-card-couples', href:'/accommodation/couples/'},
  ];
  return `<section class="section rates-section" id="rates" aria-labelledby="rates-title">
  <div class="section-heading"><div><span class="section-kicker">STRAIGHTFORWARD PRICING</span><h2 id="rates-title">Simple, transparent weekly rates.</h2></div><p>Furnished stays with bills included. Our team confirms availability before you book.</p></div>
  <div class="rate-grid">${offers.map(o => `
    <article class="rate-card${o.style || ''}">
      <div class="rate-card-heading"><h3 class="rate-title">${o.title}</h3><span class="rate-term">${o.term}</span></div>
      <p class="rate-price"><strong>$${PUBLIC_RATES[o.key]}</strong><span>${o.unit}</span></p>
      <p class="rate-description">${o.description}</p>
      <a class="rate-cta" href="${o.href || '/enquire?offer='+o.key}">${o.label} <span aria-hidden="true">↗</span></a>
    </article>`).join('')}
  </div>
  <p class="inclusions">Included in advertised rent: <strong>electricity · water · gas · internet</strong>. Electricity allowances per property per three months: Fulham $1,000; Clapham $800; Oaklands Park $1,000. See your agreement for excess allocation.</p>
</section>`;
}
