import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePublicSite, renderListing} from './public-site.js';
import worker from './worker.js';

const cat = {
  properties: [{id:'p', slug:'house', name:'Approved house', suburb:'Fulham', description:'Approved description'}],
  rooms: [
    {id:'r', property_id:'p', slug:'room-1', title:'Room 1', description:'Approved room', capacity:1, photos:[], amenities:[]},
    {id:'s', property_id:'p', slug:'room-2', title:'Room 2', description:'Approved shared room', capacity:2, photos:[], amenities:[]},
  ],
};
function schema(page) {
  return JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
}
test('collection structured data matches the visible approved room links and breadcrumbs', async () => {
  for (const route of [{kind:'location',suburb:'fulham'}, {kind:'property',suburb:'fulham',property:'house'}]) {
    const page = await renderListing(route, cat).text();
    const graph = schema(page)['@graph'];
    const list = graph[0].mainEntity;
    assert.equal(graph[0]['@type'], 'CollectionPage');
    assert.equal(list.numberOfItems, 2);
    assert.deepEqual(list.itemListElement.map(x => x.name), ['Room 1','Room 2']);
    for (const item of list.itemListElement) assert.ok(page.includes('href="' + new URL(item.url).pathname + '"'));
    assert.equal(graph[1]['@type'], 'BreadcrumbList');
    assert.deepEqual(graph[1].itemListElement.map(x => x.position), route.kind === 'property' ? [1,2,3] : [1,2]);
    assert.ok(!page.includes('aggregateRating'));
  }
});
test('empty and multiple-property suburb collections describe the listings actually shown', async () => {
  const empty = schema(await renderListing({kind:'location',suburb:'clapham'},cat).text());
  assert.equal(empty['@graph'][0].mainEntity.numberOfItems, 0);
  const multiple = {...cat,properties:[...cat.properties,{id:'q',slug:'second-house',name:'Second house',suburb:'Fulham'}]};
  const page = await renderListing({kind:'location',suburb:'fulham'},multiple).text();
  const items = schema(page)['@graph'][0].mainEntity.itemListElement;
  assert.deepEqual(items.map(x => x.name), ['Approved house','Second house']);
  assert.ok(items.every(x => !x.url.includes('/rooms/')));
});
test('room heading and related navigation identify geography without inventing inventory', async () => {
  const page = await renderListing({kind:'room',suburb:'fulham',property:'house',room:'room-1'},cat).text();
  assert.match(page, /<h1>Room 1 — Private room in Fulham, Adelaide<\/h1>/);
  assert.ok(page.includes('href="/locations/fulham/properties/house/rooms/room-2/"'));
  for (const path of ['/student-accommodation-adelaide/','/locations/clapham/','/locations/oaklands-park/']) assert.ok(page.includes('href="'+path+'"'));
});
test('duplicate URL spellings redirect once to the declared canonical path', async () => {
  for (const path of ['/locations//fulham/','/locations/fulham//','/locations/fulham']) {
    const response = await handlePublicSite(new Request('https://sakanlodge.com'+path+'?utm_source=test'),{});
    assert.equal(response.status,308);
    assert.equal(response.headers.get('location'),'https://sakanlodge.com/locations/fulham/?utm_source=test');
  }
  for (const [alias,target] of [['/index.html','/'],['/privacy.html','/privacy'],['/privacy/','/privacy'],['/terms.html','/terms'],['/terms/','/terms']]) {
    const response = await worker.fetch(new Request('https://sakanlodge.com'+alias+'?ref=test'),{});
    assert.equal(response.status,301);
    assert.equal(response.headers.get('location'),'https://sakanlodge.com'+target+'?ref=test');
  }
});
test('missing public files cannot return a successful staff SPA while staff routes still load', async () => {
  const env = {ASSETS:{fetch:async () => new Response('<html>Staff shell</html>', {headers:{'content-type':'text/html'}})}};
  for (const path of ['/missing.html','/missing.png','/assets/missing.js']) {
    const response = await worker.fetch(new Request('https://sakanlodge.com'+path),env);
    assert.equal(response.status,404);
    assert.equal(response.headers.get('X-Robots-Tag'),'noindex');
    assert.ok(!(await response.text()).includes('Staff shell'));
  }
  const staff = await worker.fetch(new Request('https://sakanlodge.com/ledger/tenants'),env);
  assert.equal(staff.status,200);
  assert.equal(staff.headers.get('X-Robots-Tag'),'noindex, nofollow');
  assert.ok((await staff.text()).includes('Staff shell'));
  const image = await worker.fetch(new Request('https://sakanlodge.com/room-photos/real.webp'),{ASSETS:{fetch:async()=>new Response('image',{headers:{'content-type':'image/webp'}})}});
  assert.equal(image.status,200);
  assert.equal(image.headers.get('content-type'),'image/webp');
});
