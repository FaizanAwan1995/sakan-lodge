import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantStatus, tenantReference, tenantMatches, reservationTenants, roomAtCapacity } from './tenant-model.js';
const today='2026-10-19';
const person={id:'tenant-1',name:'Same Name',room_id:'room-1',start_date:today,end_date:'2026-10-20'};
test('one tenant reference remains stable across rename and room moves',()=>{
 assert.equal(tenantReference(person),tenantReference({...person,name:'Renamed',room_id:'room-2'}));
 assert.equal(tenantMatches(person,'TENANT-1','Active',today),true);
 assert.equal(tenantMatches({...person,id:'tenant-2'},'tenant-1','all',today),false);
});
test('status distinguishes upcoming arrivals, scheduled departure and immediate checkout',()=>{
 assert.equal(tenantStatus(person,today),'Active');
 assert.equal(tenantStatus({...person,start_date:'2026-10-21'},today),'Upcoming');
 assert.equal(tenantStatus({...person,checked_out_at:'2026-10-19T01:00:00Z'},today),'Checked out');
 assert.equal(tenantStatus(person,'2026-10-20'),'Checked out');
});
test('booking accounts resolve current data by ID without matching equal tenant names',()=>{
 const second={...person,id:'tenant-2'};
 assert.deepEqual(reservationTenants({checked_in_person_id:person.id,assigned_people:[person.id]},[person,second]),[person]);
 assert.deepEqual(reservationTenants({assigned_people:[person.id,second.id]},[person,second]).map(p=>p.id),['tenant-1','tenant-2']);
});
test('immediate same-day checkout frees capacity in the edit form despite minimum-night billing',()=>{
 const incoming={id:'new',room_id:'room-1',start_date:today,end_date:'2026-10-22'};
 const room={id:'room-1',capacity:1};
 assert.equal(roomAtCapacity([person],room,incoming),true);
 assert.equal(roomAtCapacity([{...person,checked_out_at:'2026-10-19T01:00:00Z'}],room,incoming),false);
 assert.equal(roomAtCapacity([person],room,person),false);
});
