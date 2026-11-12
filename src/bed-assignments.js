import { occupancyEnd } from './tenant-model.js';
export function bedReference(room, bed) {
  if (!room) return '';
  const label=String(room.label||'').trim();
  const match=/^room\s*(\d+)$/i.exec(label);
  const base=match?'R'+match[1]:label;
  return bed ? `${base}-B${bed}` : label;
}
export function bedChoices(db,room,person) {
  if(!room)return [];
  const end=person.end_date||'9999-12-31';
  return Array.from({length:Number(room.capacity)},(_,i)=>i+1).map(number=>({number,label:bedReference(room,number),busy:(db.people||[]).some(p=>p.id!==person.id&&p.room_id===room.id&&Number(p.bed_number)===number&&p.start_date<end&&occupancyEnd(p)>person.start_date&&occupancyEnd(p)>p.start_date)}));
}
export function parseBedNumbers(value) {
  const text=String(value||'').trim();
  if(!text)return [];
  if(!/^\d+(\s*,\s*\d+)*$/.test(text))throw Error('Enter bed numbers such as 1 or 1,2.');
  const beds=text.split(',').map(Number);
  if(beds.some(n=>n<1)||new Set(beds).size!==beds.length)throw Error('Choose different positive bed numbers.');
  return beds;
}
