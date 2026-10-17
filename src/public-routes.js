/**
 * Public route parser and output escaping. Never expose unpublished profiles.
 * These functions do not access resident, payment or ledger data.
 */
export const LOCATION_SLUGS = Object.freeze(['fulham','clapham','oaklands-park']);
export const PUBLIC_BASE = '/locations/';
export function parsePublicRoute(pathname) {
  if (typeof pathname !== 'string') return null;
  const path = pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  if (segments[0] !== 'locations' || !LOCATION_SLUGS.includes(segments[1])) return null;
  if (segments.length === 2) return {kind:'location',suburb:segments[1]};
  if (segments[2] !== 'properties' || !isSlug(segments[3])) return null;
  if (segments.length === 4) return {kind:'property',suburb:segments[1],property:segments[3]};
  if (segments.length === 6 && segments[4] === 'rooms' && isSlug(segments[5])) {
    return {kind:'room',suburb:segments[1],property:segments[3],room:segments[5]};
  }
  return null;
}
function isSlug(value) {return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 90;}
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
export function publicPath({suburb,property,room}) {
  if (!LOCATION_SLUGS.includes(suburb)) throw new Error('Unknown public suburb');
  let path = '/locations/'+suburb+'/';
  if (property) {if(!isSlug(property)) throw new Error('Invalid property slug');path+='properties/'+property+'/';}
  if (room) {if(!property||!isSlug(room)) throw new Error('Invalid room route');path+='rooms/'+room+'/';}
  return path;
}
