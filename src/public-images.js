import {escapeHtml as h} from './public-routes.js';

// Display derivatives of approved photos. Originals stay in room storage.
const grannyPhotos = new Map([
 ['https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/room-photos/3cd042a0-2569-472a-ab1a-f0f5e2044577/a6a03330-6b8f-4a55-b026-a4eb40e02541.jpg', '/property-photos/fulham-granny-bedroom'],
 ['https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/room-photos/3cd042a0-2569-472a-ab1a-f0f5e2044577/3696609a-03c9-465c-8bfd-3f2b2f2d7ea9.jpg', '/property-photos/fulham-granny-bedroom-wardrobe'],
 ['https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/room-photos/3cd042a0-2569-472a-ab1a-f0f5e2044577/187c8a82-b189-4538-98c6-c47e4fac1d8c.jpg', '/property-photos/fulham-granny-kitchen'],
 ['https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/room-photos/3cd042a0-2569-472a-ab1a-f0f5e2044577/ec5934c1-105c-464e-a372-4f6cb6ee8225.jpg', '/property-photos/fulham-granny-kitchen-dining'],
 ['https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/room-photos/3cd042a0-2569-472a-ab1a-f0f5e2044577/4b643e6c-6271-48b6-91ac-aaa656d0d773.jpg', '/property-photos/fulham-granny-bathroom'],
 ['https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/segment-photos/couples/e74512b3-46b8-4eea-af46-3ccf0be94f5a.jpg', '/property-photos/fulham-granny-bedroom'],
 ['https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/segment-photos/couples/e2c3b10b-e6fe-4ffc-b062-b45cc10cf0e7.jpg', '/property-photos/fulham-granny-bedroom-wardrobe'],
]);
export const publicImageSrc = src => grannyPhotos.has(src) ? grannyPhotos.get(src)+'-1200.webp' : src;
export function responsiveImageAttributes(src, sizes) {
 const base=grannyPhotos.get(src);
 return `src="${h(publicImageSrc(src))}"${base?` srcset="${h(base)}-640.webp 640w, ${h(base)}-1200.webp 1200w" sizes="${h(sizes)}"`:''}`;
}
