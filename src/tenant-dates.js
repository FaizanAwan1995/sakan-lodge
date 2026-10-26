export function tenantDateError(p){
 for(const key of ['start_date','end_date','paid_up_to','rent_cycle_anchor']){
  const d=p[key];if(!d)continue;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d<'2000-01-01'||d>'2100-12-31'||Number.isNaN(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)return 'Enter valid tenancy dates with a year between 2000 and 2100.';
 }
 if(p.start_date&&p.end_date&&p.end_date<=p.start_date)return 'Check-out must be after check-in.';
 if(p.start_date&&p.paid_up_to&&Date.parse(p.paid_up_to)<Date.parse(p.start_date)-86400000)return 'Paid-through date cannot be earlier than the day before check-in.';
 return '';
}
