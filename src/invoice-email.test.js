import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceMime} from './invoice-email.js';
const invoice={
 id:'00000000-0000-4000-8000-000000000123',number:123,
 snapshot:{
  document_type:'bond_receipt',tenant_name:'Synthetic Tenant',tenant_email:'tenant@example.test',
  address:'10 Synthetic Road, Test SA',room:'Room 1',
  payment:{amount:510,date:'2026-11-03',method:'transfer'},
  lines:[{description:'Refundable accommodation bond received',amount:510}],
  cc:['sakanlodges@gmail.com','admin1@example.test','admin2@example.test']
 }
};
test('bond emails are clearly bond receipts and not rent invoices',()=>{
 const encoded=invoiceMime(invoice,new Uint8Array([37,80,68,70]));
 const raw=Buffer.from(encoded.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
 assert.match(raw,/Subject: SAKAN Lodge - bond payment receipt #123/);
 assert.match(raw,/SAKAN-bond-receipt-123\.pdf/);
 assert.doesNotMatch(raw,/Subject:.*rent invoice/);
 const bodyBase64=raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\s/g,'');
 const body=Buffer.from(bodyBase64,'base64').toString('utf8');
 assert.match(body,/refundable bond is recorded separately from rental payments/i);
 assert.match(body,/AUD \$510\.00/);
});
test('rent invoice explains referral credit separately from money received',()=>{
 const rent={...invoice,snapshot:{...invoice.snapshot,document_type:undefined,payment:{amount:250,date:'2026-11-09',method:'cash'},referral_credit:100,referred_person:'New Resident',total_settled:350,lines:[{description:'Accommodation rent',amount:350}]}};
 const raw=Buffer.from(invoiceMime(rent,new Uint8Array([37,80,68,70])).replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
 const body=Buffer.from(raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\s/g,''),'base64').toString('utf8');
 assert.match(body,/rent payment of AUD \$250\.00/);
 assert.match(body,/Referral credit: AUD \$100\.00 \(referred New Resident\)/);
 assert.match(body,/Total covered: AUD \$350\.00/);
});
