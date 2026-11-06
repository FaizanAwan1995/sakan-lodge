import { addCalendarMonths } from './accommodation-rules.js';
export function validAgreementDate(value) {
  try { return /^\d{4}-\d{2}-\d{2}$/.test(value) && addCalendarMonths(value,0)===value && value>='2000-01-01' && value<='2100-12-31'; } catch { return false; }
}
export function changeAgreementDetail(form,key,value) {
  const next={...form,[key]:value};
  if(key==='arrival_date' || key==='departure_date') {
    if(form.term_description===`${form.arrival_date} to ${form.departure_date}`)next.term_description=`${next.arrival_date} to ${next.departure_date}`;
    if(key==='arrival_date' && form.first_rent_due===form.arrival_date)next.first_rent_due=value;
  }
  return next;
}
export function agreementDetailsError(form) {
  if(!validAgreementDate(form.arrival_date))return 'Enter a valid check-in date.';
  if(!validAgreementDate(form.departure_date)||form.departure_date<=form.arrival_date)return 'Departure must be after check-in. The departure day is the checkout day.';
  if(!validAgreementDate(form.first_rent_due)||form.first_rent_due>=form.departure_date)return 'First rent due must be a valid date before departure.';
  if(String(form.full_name||'').trim().length<2)return 'Enter the tenant’s full name.';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email||''))return 'Enter a valid tenant email.';
  if(String(form.phone||'').trim().length<6)return 'Enter a tenant contact phone number.';
  return '';
}
