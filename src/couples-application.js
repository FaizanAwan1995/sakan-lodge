export const GRANNY_PATH='/locations/fulham/properties/fulham-house-1/rooms/granny-flat/';
export const isCouplesRoom=(room,location)=>room?.slug==='granny-flat'&&location==='Fulham';
export function couplesFields() {
  return `<p><strong>Apply together for the whole granny flat.</strong> $500 per couple/week, bills included. Total bond $1,000. Stay longer than three calendar months.</p><input type="hidden" name="spaces_requested" value="2">${[1,2].map(i=>`<fieldset><legend>Occupant ${i}${i===1?' · main contact':''}</legend><label for="occupant-${i}-name">Full legal name (as on photo ID)</label><input id="occupant-${i}-name" name="occupant_${i}_name" autocomplete="section-occupant${i} name" minlength="2" maxlength="120" required><label for="occupant-${i}-email">Email</label><input id="occupant-${i}-email" name="occupant_${i}_email" type="email" autocomplete="section-occupant${i} email" maxlength="254" required><label for="occupant-${i}-phone">Phone</label><input id="occupant-${i}-phone" name="occupant_${i}_phone" type="tel" autocomplete="section-occupant${i} tel" minlength="6" maxlength="30" required><label for="occupant-${i}-occupation">Occupation (optional)</label><input id="occupant-${i}-occupation" name="occupant_${i}_occupation" maxlength="80"><label for="occupant-${i}-id">Photo ID (passport or driver’s licence)</label><input id="occupant-${i}-id" name="occupant_${i}_id" type="file" accept="image/jpeg,image/png,application/pdf" required><small>Clear JPG, PNG or PDF, up to 5 MB. Your ID is stored privately for authorised SAKAN admins to review.</small></fieldset>`).join('')}<label for="introduction">Anything else about your stay? (optional)</label><textarea id="introduction" name="introduction" maxlength="2000"></textarea><label class="application-consent"><input type="checkbox" name="application_consent" value="yes" required><span>Both occupants consent to using their details and photo IDs for this application. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</span></label>`;
}
export function validateOccupants(input) {
  if(!Array.isArray(input)||input.length!==2)throw Error('Provide details for both occupants.');
  return input.map((p,i)=>{
    const name=String(p.name||'').trim(),email=String(p.email||'').trim().toLowerCase(),phone=String(p.phone||'').trim(),occupation=String(p.occupation||'').trim();
    if(name.length<2||name.length>120||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)||email.length>254||phone.length<6||phone.length>30||occupation.length>80)throw Error(`Check occupant ${i+1}’s name, email and phone.`);
    return {name,email,phone,occupation};
  });
}
export function idFileType(bytes) {
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return {mime:'image/jpeg',ext:'jpg'};
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return {mime:'image/png',ext:'png'};
  if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')return {mime:'application/pdf',ext:'pdf'};
  throw Error('Photo IDs must be JPG, PNG or PDF files. Convert HEIC photos to JPG before uploading.');
}
