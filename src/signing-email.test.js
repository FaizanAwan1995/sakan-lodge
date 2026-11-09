import test from 'node:test';import assert from 'node:assert/strict';
import {signingEmailHtml} from './signing-email.js';import {alertMime} from './incoming-alerts.js';
test('signing emails show readable action buttons and escape names, reasons and untrusted links',()=>{
 const url='https://sakanlodge.com/ledger/reservations?reservation=00000000-0000-4000-8000-000000000001';
 const html=signingEmailHtml('Synthetic <Admin>',`Hi <script>alert(1)</script>\n\nReview the agreement:\n${url}\n\njavascript:alert(1)`);
 assert.match(html,/Review agreement in Ledger/);assert.ok(html.includes('href="'+url+'"'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('href="javascript:'));
});
test('automatic signing notifications include rich HTML and a plain text alternative',()=>{
 const raw=Buffer.from(alertMime({id:'00000000-0000-4000-8000-000000000001',kind:'signing_received',recipient:'admin@example.test',reply_to:'guest@example.test',subject:'Synthetic Signer has signed their agreement',body:'Hello SAKAN team,\n\nReview the agreement:\nhttps://sakanlodge.com/ledger/reservations?reservation=00000000-0000-4000-8000-000000000001'}),'base64url').toString();
 assert.match(raw,/multipart\/alternative/);assert.match(raw,/Content-Type: text\/plain/);assert.match(raw,/Content-Type: text\/html/);assert.ok(!raw.includes('Content-Disposition: attachment'));
});
