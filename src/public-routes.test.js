import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicRoute,publicPath,escapeHtml} from './public-routes.js';
test('nested public URLs parse correctly',()=>{
 assert.deepEqual(parsePublicRoute('/locations/fulham/'),{kind:'location',suburb:'fulham'});
 assert.deepEqual(parsePublicRoute('/locations/fulham/properties/fulham-house-1/rooms/room-1/'),{kind:'room',suburb:'fulham',property:'fulham-house-1',room:'room-1'});
 assert.equal(publicPath({suburb:'fulham',property:'fulham-house-1',room:'room-1'}),'/locations/fulham/properties/fulham-house-1/rooms/room-1/');
});
test('unknown locations and malformed slugs are rejected',()=>{
 assert.equal(parsePublicRoute('/locations/woodville/'),null);
 assert.equal(parsePublicRoute('/locations/fulham/properties/../'),null);
 assert.throws(()=>publicPath({suburb:'fulham',property:'A B'}));
});
test('untrusted public text is escaped',()=>{
 assert.equal(escapeHtml('<script>"hello"</script>'),'&lt;script&gt;&quot;hello&quot;&lt;/script&gt;');
});
