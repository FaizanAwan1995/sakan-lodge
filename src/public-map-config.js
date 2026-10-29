// Approved public map points live in Cloudflare configuration. Never include
// private ledger address strings or precise property coordinates in source.
export function publicMapProperties(value){
 let input;try{input=JSON.parse(value || '{}');}catch{return {};}
 const output={};
 for(const slug of ['fulham','clapham','oaklands-park']){
  const point=input?.[slug];
  if(point&&typeof point.lat==='number'&&Number.isFinite(point.lat)&&point.lat>=-35.1&&point.lat<=-34.8&&typeof point.lng==='number'&&Number.isFinite(point.lng)&&point.lng>=138.4&&point.lng<=138.7)output[slug]={lat:point.lat,lng:point.lng};
 }
 return output;
}
