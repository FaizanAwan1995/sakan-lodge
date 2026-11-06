import test from 'node:test';
import assert from 'node:assert/strict';
import {changeAgreementDetail,agreementDetailsError,validAgreementDate} from './agreement-details.js';
const form={arrival_date:'2026-12-01',departure_date:'2027-03-01',first_rent_due:'2026-12-01',term_description:'2026-12-01 to 2027-03-01',full_name:'Synthetic Tenant',email:'tenant@example.test',phone:'0400000000'};
test('check-in edits keep generated term and default first rent due aligned',()=>{
 const next=changeAgreementDetail(form,'arrival_date','2026-12-04');
 assert.equal(next.term_description,'2026-12-04 to 2027-03-01');
 assert.equal(next.first_rent_due,'2026-12-04');
 assert.equal(form.arrival_date,'2026-12-01');
 const custom=changeAgreementDetail({...form,first_rent_due:'2026-11-20',term_description:'Custom agreed fixed term'},'arrival_date','2026-12-04');
 assert.equal(custom.first_rent_due,'2026-11-20');assert.equal(custom.term_description,'Custom agreed fixed term');
});
test('critical tenant fields and date order validate before generation',()=>{
 assert.equal(agreementDetailsError(form),'');
 for(const patch of [{departure_date:form.arrival_date},{arrival_date:'2026-02-30'},{first_rent_due:'2027-03-01'},{email:'bad'},{phone:''},{full_name:''}])assert.ok(agreementDetailsError({...form,...patch}));
 assert.equal(validAgreementDate('2028-02-29'),true);assert.equal(validAgreementDate('2027-02-29'),false);
});
