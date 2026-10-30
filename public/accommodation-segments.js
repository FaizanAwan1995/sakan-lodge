(()=>{
 const page=document.querySelector('[data-stay-segment]');
 function prefill(key,preferredLocation){
  const form=document.getElementById('general-enquiry-form');if(!form)return;
  const note=form.elements.namedItem('message');
  if(note&&!note.value)note.value=key==='women'?'I am enquiring about women-only accommodation at Sakan Fulham. Please confirm availability and when the women-only household will be ready.':key==='men'?'I am enquiring about men-only accommodation.':'We are enquiring about the Fulham granny flat for a couple. Please confirm availability, occupancy and rates for our dates.';
  const location=form.elements.namedItem('location');if(location&&preferredLocation)location.value=preferredLocation;else if((key==='women'||key==='couples')&&location&&!location.value)location.value='Fulham';
  const occupants=form.elements.namedItem('occupants');if(occupants)occupants.value=key==='couples'?'2':occupants.value||'1';
 }
 document.addEventListener('click',event=>{
  const trigger=event.target.closest('[data-audience-enquiry]');
  if(trigger){prefill(trigger.dataset.audienceEnquiry,trigger.dataset.enquiryLocation);document.getElementById('open-enquiry')?.click();}
  else if(event.target.closest('#open-enquiry')&&page)prefill(page.dataset.staySegment);
 });
})();
