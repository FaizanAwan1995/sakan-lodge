/* Website enquiries submit directly; no visitor email application is required. */
(()=>{
 const d=document.getElementById('general-enquiry'),f=document.getElementById('general-enquiry-form'),enquire=document.getElementById('open-enquiry');if(!d||!f||!enquire)return;
 const submit=f.querySelector('[type="submit"]');
 const context=SakanEnquiryContext.read(window.location.search);
 SakanEnquiryContext.apply(f,context);
 if(Object.keys(context).length){
  const summary=document.createElement('p');summary.className='enquiry-context';
  summary.textContent='Your selection: '+[context.room_title,context.location,context.audience,({shared:'shared room',private:'private room',short:'short stay',couples:'couples granny flat'}[context.offer]),context.arrival?'from '+context.arrival:''].filter(Boolean).join(' · ')+'. You can change these details below.';
  f.querySelector('.enquiry-dialog-heading').after(summary);
 }
 const retry=document.createElement('button');retry.type='button';retry.className='enquiry-retry';retry.textContent='Retry secure form';retry.hidden=true;submit.before(retry);
 retry.addEventListener('click',()=>{started=false;start();});
 const status=document.createElement('p');status.id='enquiry-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const verification=document.createElement('div');verification.id='enquiry-verification';
 submit.before(verification,status);
 let key=SakanEnquiryContext.requestId(),signature='',token='',widget,busy=false,received=false,started=false;
 let measurement;
 const state=()=>{submit.disabled=busy||received||!token;};state();
 async function start(){
  retry.hidden=true;
  if(started){if(widget!==undefined&&!token&&window.turnstile)window.turnstile.reset(widget);return;}started=true;status.textContent='Loading secure enquiry form…';
  try{
   const response=await fetch('/api/enquiries',{signal:AbortSignal.timeout(10000)});const config=await response.json().catch(()=>({}));if(!response.ok||!config.enabled||!config.site_key)throw Error('Enquiries are temporarily unavailable. Email sakanlodges@gmail.com or contact us on WhatsApp.');
   if(config.conversion_send_to&&!measurement){
    try{
     const {createEnquiryMeasurement}=await import('/enquiry-measurement.js');measurement=createEnquiryMeasurement(config.conversion_send_to);
     if(measurement){const label=document.createElement('label'),choice=document.createElement('input');choice.type='checkbox';label.append(choice,document.createTextNode(' Allow Google Ads to measure this enquiry (optional).'));label.className='enquiry-measurement-choice';choice.addEventListener('change',()=>{try{measurement.consent(choice.checked);}catch{/* Optional measurement. */}});submit.before(label);}
    }catch{/* Measurement must not prevent an enquiry. */}
   }
   if(!window.turnstile)await new Promise((resolve,reject)=>{
    let script=document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
    const timeout=setTimeout(()=>reject(Error('Verification could not load. Please refresh the page and try again.')),15000);
    const done=()=>{clearTimeout(timeout);resolve();};
    if(script){script.addEventListener('load',done,{once:true});script.addEventListener('error',reject,{once:true});if(window.turnstile)done();}
    else{script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=done;script.onerror=reject;document.head.append(script);}
   });
   status.textContent='Complete verification, then send your enquiry.';
   if(widget!==undefined){window.turnstile.reset(widget);return;}
   widget=window.turnstile.render(verification,{sitekey:config.site_key,action:'enquiry',size:'flexible',callback:value=>{token=value;state();if(!busy&&!received)status.textContent='';},'expired-callback':()=>{token='';state();},'error-callback':()=>{token='';state();retry.hidden=false;status.textContent='Verification failed. Retry the secure form; your details are still here.';}});
  }catch(error){started=false;retry.hidden=false;status.textContent=(error.name==='TimeoutError'||error.name==='AbortError')?'The enquiry form could not connect. Close and reopen to retry, or contact us by email or WhatsApp.':error.message||'Unable to load verification. Please contact us by email or WhatsApp.';}
 }
 const enquiryPage=/^\/enquire\/?$/.test(window.location.pathname);
 function openForm(){if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');start();}
 enquire.addEventListener('click',event=>{
  if(enquiryPage){event.preventDefault();openForm();}
  else {event.preventDefault();const segment=document.querySelector('[data-stay-segment]')?.dataset.staySegment;window.location.assign('/enquire'+(segment?'?audience='+encodeURIComponent(segment):''));}
 });
 if(enquiryPage)openForm();
 d.addEventListener('close',()=>{if(received){f.reset();received=false;key=SakanEnquiryContext.requestId();signature='';submit.textContent='Send enquiry';token='';state();}});
 document.getElementById('close-enquiry')?.addEventListener('click',()=>d.close());d.addEventListener('click',e=>{if(e.target===d)d.close();});
 f.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||received||!token||!f.reportValidity())return;
  const fields=new FormData(f);const data=Object.fromEntries(['full_name','email','phone','location','accommodation','move_in','occupants','message'].map(key=>[key,fields.get(key)||'']));const next=JSON.stringify(data);if(signature&&signature!==next)key=SakanEnquiryContext.requestId();signature=next;
  busy=true;state();f.setAttribute('aria-busy','true');submit.textContent='Sending enquiry…';status.textContent='Sending your enquiry…';
  try{
   const response=await fetch('/api/enquiries',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({...data,turnstile_token:token}),signal:AbortSignal.timeout(20000)});const result=await response.json().catch(()=>({}));
   if(!response.ok||result.received!==true)throw Error(result.error||'Receipt could not be confirmed. Keep your details and try again.');
   received=true;submit.textContent='Enquiry received';status.textContent=result.message+' Reference: '+result.reference;
   // Success-only, anonymous hook for the conversion tag. Never include form data.
   try{measurement?.received(key);window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:'sakan_enquiry_received',enquiry_id:key});}catch{/* Measurement must never turn a saved enquiry into a failure. */}
  }catch(error){status.textContent=error.message||'Receipt could not be confirmed. Keep your details and try again.';token='';if(window.turnstile&&widget!==undefined)window.turnstile.reset(widget);}
  finally{busy=false;f.removeAttribute('aria-busy');if(!received)submit.textContent='Send enquiry';state();}
 });
 const palette=document.getElementById('contact-palette'),hide=document.getElementById('contact-palette-close'),show=document.getElementById('contact-palette-open');if(!palette||!hide||!show)return;
 const setExpanded=expanded=>{palette.hidden=!expanded;show.hidden=false;hide.setAttribute('aria-expanded',String(expanded));show.setAttribute('aria-expanded',String(expanded));};hide.addEventListener('click',()=>setExpanded(false));show.addEventListener('click',()=>setExpanded(palette.hidden));setExpanded(false);show.textContent='Contact & enquire';document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!palette.hidden){setExpanded(false);show.focus();}});document.addEventListener('pointerdown',e=>{if(!document.getElementById('floating-contact').contains(e.target))setExpanded(false);});
})();
