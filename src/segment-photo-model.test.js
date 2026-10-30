import test from 'node:test';import assert from 'node:assert/strict';import {segmentRooms} from './segment-photo-model.js';import {renderSegmentPage,renderSegmentChoices,segmentPhotoUrls} from './accommodation-segments.js';import {tabFromPath} from './app-helpers.js';
test('room upload selector separates Fulham women, men suburbs and couples granny flat',()=>{
 const properties=[{property_id:'f',suburb:'Fulham'},{property_id:'c',suburb:'Clapham'},{property_id:'o',suburb:'Oaklands Park'}];const rooms=[{id:'1',property_id:'f',label:'Room 1'},{id:'2',property_id:'f',label:'Granny Flat'},{id:'3',property_id:'c',label:'Room 3'},{id:'4',property_id:'o',label:'Room 4'},{id:'5',property_id:'unknown',label:'Unknown'}];
 assert.deepEqual(segmentRooms('women',rooms,properties).map(r=>r.id),['1']);assert.deepEqual(segmentRooms('men',rooms,properties).map(r=>r.id),['3','4']);assert.deepEqual(segmentRooms('couples',rooms,properties).map(r=>r.id),['2']);assert.equal(tabFromPath('/website-photos'),'website-photos');
});
test('saved galleries reach homepage and segment pages, including explicit removal of all photos',()=>{
 const url='https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/segment-photos/women/00000000-0000-4000-8000-000000000001.jpg';const galleries={women:[url]};
 assert.ok(renderSegmentPage('women',galleries).includes(url));assert.ok(renderSegmentChoices(galleries).includes(url));assert.ok(!renderSegmentPage('women',{women:[]}).includes('<figure>'));assert.deepEqual(segmentPhotoUrls('women',{women:['javascript:alert(1)','https://evil.test/a.jpg']}),[]);
 const body=renderSegmentPage('women');for(const n of ['1','2'])assert.ok(body.includes('sakan-fulham-women-room-'+n+'.webp'));
});
