/* Public room preferences only. Never put visitor contact details into links. */
(() => {
  const locations = ['Fulham', 'Clapham', 'Oaklands Park'];
  const audiences = ['men', 'women', 'couples'];
  const offers = {shared: 'Shared accommodation', private: 'Private room', short: 'Private room', couples: 'Private room'};
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  function read(search) {
    const p = new URLSearchParams(search), c = {};
    if (audiences.includes(p.get('audience'))) c.audience = p.get('audience');
    if (locations.includes(p.get('location'))) c.location = p.get('location');
    if (Object.hasOwn(offers, p.get('offer'))) c.offer = p.get('offer');
    if (date(p.get('arrival'))) c.arrival = p.get('arrival');
    if (date(p.get('departure')) && (!c.arrival || p.get('departure') > c.arrival)) c.departure = p.get('departure');
    if (/^[1-9]\d?$/.test(p.get('occupants') || '')) c.occupants = p.get('occupants');
    if (/^[a-f0-9-]{36}$/i.test(p.get('room') || '')) c.room = p.get('room');
    if (p.get('room_title')) c.room_title = p.get('room_title').replace(/[\x00-\x1f]/g, ' ').slice(0, 120);
    return c;
  }
  function link(values) {
    const p = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));
    return '/enquire?' + new URLSearchParams(read(p)).toString();
  }
  function apply(form, c) {
    const field = name => form.elements.namedItem(name);
    const set = (name, value) => { if (value && field(name) && !field(name).value) field(name).value = value; };
    set('location', c.location || (['women', 'couples'].includes(c.audience) || c.offer === 'couples' ? 'Fulham' : ''));
    set('accommodation', offers[c.offer] || (c.audience === 'couples' ? 'Private room' : ''));
    set('move_in', c.arrival);
    if (c.occupants || c.audience === 'couples' || c.offer === 'couples') {
      const count = Number(c.occupants || 2);
      field('occupants').value = count > 2 ? '3+' : String(count);
    }
    const notes = [];
    if (c.audience === 'women') notes.push('Female-only accommodation at Fulham: please confirm household readiness.');
    if (c.audience === 'men') notes.push('Male-only accommodation.');
    if (c.audience === 'couples' || c.offer === 'couples') notes.push('Fulham granny flat for a couple.');
    if (c.offer === 'short') notes.push('Interested in a shorter stay; please confirm the rate for my dates.');
    if (c.room_title) notes.push('Preferred room: ' + c.room_title);
    if (c.room) notes.push('Room reference: ' + c.room);
    if (c.departure) notes.push('Preferred checkout: ' + c.departure);
    set('message', notes.join('\n'));
    return notes;
  }
  function requestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  }
  globalThis.SakanEnquiryContext = Object.freeze({read, link, apply, requestId});
})();
