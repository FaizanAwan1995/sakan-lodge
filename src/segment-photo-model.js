// Audience mapping does not infer couples suitability from room capacity.
export function segmentRooms(segment,rooms=[],properties=[],roomProfiles=[]){
 const byId=new Map(properties.map(p=>[p.property_id,p]));const profiles=new Map(roomProfiles.map(p=>[p.room_id,p]));
 return rooms.filter(room=>{const suburb=byId.get(room.property_id)?.suburb;const granny=/granny/i.test(room.label||'')||profiles.get(room.id)?.slug==='granny-flat';
  if(segment==='women')return suburb==='Fulham'&&!granny;
  if(segment==='men')return ['Clapham','Oaklands Park'].includes(suburb);
  return segment==='couples'&&suburb==='Fulham'&&granny;
 }).sort((a,b)=>(byId.get(a.property_id)?.public_name||'').localeCompare(byId.get(b.property_id)?.public_name||'')||(a.label||'').localeCompare(b.label||'',undefined,{numeric:true}));
}
