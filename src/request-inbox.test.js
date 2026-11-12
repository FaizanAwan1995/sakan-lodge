import test from 'node:test';
import assert from 'node:assert/strict';
import {matchRoutes} from 'react-router-dom';
import {LEDGER_ROUTES,legacyLedgerPath,saveLedgerVisit,readLedgerVisit} from './ledger-routing.js';
import {tabFromPath} from './app-helpers.js';
import {combineRequests,requestDestination,inboxSection,inboxCounts,markSectionRead,noticeKey,requestBadgeCount,visibleEnquiryThreads} from './request-inbox.js';
const website={id:'web-1',reference:'ENQ-1',created_at:'2026-11-12T01:00:00Z',details:{full_name:'Website Guest'}};
const booking={id:'res-1',reservation_code:'SK-1',full_name:'Booking Guest',created_at:'2026-11-11T01:00:00Z'};
const thread={id:'thread-1',source:'website',website_enquiry_id:website.id,status:'open'};
test('notification enquiry links resolve to a registered Enquiries page and survive resume',()=>{
 const rows=combineRequests([booking],[website],[thread]);
 for(const row of rows){const url=new URL(requestDestination(row),'https://sakanlodge.com');const matches=matchRoutes(LEDGER_ROUTES.map(path=>({path})),url.pathname);assert.ok(matches);assert.equal(tabFromPath(url.pathname),row.kind==='reservation'?'reservations':'enquiries');}
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 saveLedgerVisit(storage,'admin','/enquiries','?website=web-1',240);assert.equal(readLedgerVisit(storage,'admin').pathname,'/enquiries');assert.equal(readLedgerVisit(storage,'admin').search,'?website=web-1');assert.equal(legacyLedgerPath('/enquiries'),'/ledger/enquiries');
});
test('reservations and enquiries have independent unread counts and marking one preserves the other',()=>{
 const rows=combineRequests([booking],[website],[thread]);assert.equal(rows[0].thread_id,thread.id);assert.equal(requestDestination(rows[0]),'/enquiries?id=thread-1');
 let seen=markSectionRead(rows,[],'reservations');assert.deepEqual(inboxCounts(rows,seen),{reservations:{total:1,unread:0},enquiries:{total:1,unread:1},emails:{total:0,unread:0}});
 seen=markSectionRead(rows,seen,'enquiries');assert.equal(inboxCounts(rows,seen).reservations.unread,0);assert.equal(inboxCounts(rows,seen).enquiries.unread,0);
});
test('imported website enquiries are not duplicated and a new email reply becomes unread again',()=>{
 const email={id:'mail-1',source:'email',subject:'Question',status:'open',contact_name:'Email Guest',last_message_at:'2026-11-12T02:00:00Z'};
 const rows=combineRequests([booking],[website],[thread,email]);assert.equal(rows.length,3);assert.equal(rows.filter(r=>inboxSection(r)==='enquiries').length,1);
 const seen=[noticeKey(rows[0])];const next=combineRequests([],[],[{...email,last_message_at:'2026-11-12T03:00:00Z'}]);assert.equal(inboxCounts(next,seen).emails.unread,1);assert.equal(requestBadgeCount(inboxCounts(next,seen)),0);
 assert.equal(combineRequests([],[website],[{...thread,status:'closed'}]).length,0);
});

test('a new message in a website enquiry becomes unread without duplicating its conversation',()=>{
 const original=combineRequests([],[website],[{...thread,last_message_at:website.created_at}]);
 const seen=[noticeKey(original[0])];const next=combineRequests([],[website],[{...thread,last_message_at:'2026-11-13T01:00:00Z'}]);assert.equal(next.length,1);assert.equal(inboxCounts(next,seen).enquiries.unread,1);
});

test('email conversations are optional and never inflate reservation and website inbox counts',()=>{
 const emails=Array.from({length:20},(_,i)=>({id:'email-'+i,source:'email',status:'open',contact_email:'guest@example.test',last_message_at:'2026-11-12T02:00:00Z'}));
 const rows=combineRequests([booking],[website],[thread,...emails]);const counts=inboxCounts(rows);assert.equal(counts.emails.unread,20);assert.equal(requestBadgeCount(counts),2);
 const afterEmailsRead=markSectionRead(rows,[],'emails');assert.equal(requestBadgeCount(inboxCounts(rows,afterEmailsRead)),2);
 const afterRequestsRead=markSectionRead(rows,markSectionRead(rows,[],'reservations'),'enquiries');assert.equal(requestBadgeCount(inboxCounts(rows,afterRequestsRead)),0);assert.equal(inboxCounts(rows,afterRequestsRead).emails.unread,20);
 assert.equal(visibleEnquiryThreads([thread,...emails]).length,1);assert.equal(visibleEnquiryThreads([thread,...emails],true).length,21);
 assert.match(requestDestination(rows.find(r=>r.kind==='email')),/source=email$/);
});
