export const ELECTRICITY_ALLOWANCES = Object.freeze({fulham:1000,clapham:800,'oaklands-park':1000});
export const UTILITY_SUMMARY='Electricity allowances per property per three months: Fulham $1,000; Clapham $800; Oaklands Park $1,000. Water, gas and internet are included. Your agreement explains any excess electricity allocation.';
export function utilityPolicy(suburb){
 const slug=String(suburb||'').toLowerCase().replaceAll(' ','-');
 const amount=ELECTRICITY_ALLOWANCES[slug];
 if(!amount)return UTILITY_SUMMARY;
 const name={fulham:'Fulham',clapham:'Clapham','oaklands-park':'Oaklands Park'}[slug];
 return `${name} electricity allowance: $${amount.toLocaleString('en-AU')} per property per three months. Water, gas and internet are included. Your agreement explains any excess electricity allocation.`;
}
