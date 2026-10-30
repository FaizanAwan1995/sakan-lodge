/* Website enquiries submit directly; no visitor email application is required. */
(()=>{
 const d=document.getElementById('general-enquiry'),f=document.getElementById('general-enquiry-form'),enquire=document.getElementById('open-enquiry');if(!d||!f||!enquire)return;
 const submit=f.querySelector('[type="submit"]');
 const status=document.createElement('p');status.id='enquiry-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const verification=document.createElement('div');verification.id='enquiry-verification';
 submit.before(verification,status);
 let key=crypto.randomUUID(),signature='',token='',widget,busy=false,received=false,started=false;
 const state=()=>{submit.disabled=busy||received||!token;};state();
 async function start(){
  if(started){if(widget!==undefined&&!token&&window.turnstile)window.turnstile.reset(widget);return;}started=true;status.textContent='Loading secure enquiry form…';
  try{
   const response=await fetch('/api/enquiries',{signal:AbortSignal.timeout(10000)});const config=await response.json();if(!response.ok||!config.enabled||!config.site_key)throw Error('Enquiries are temporarily unavailable. Email sakanlodges@gmail.com or contact us on WhatsApp.');
   if(!window.turnstile)await new Promise((resolve,reject)=>{
    let script=document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
    const timeout=setTimeout(()=>reject(Error('Verification could not load. Please refresh the page and try again.')),15000);
    const done=()=>{clearTimeout(timeout);resolve();};
    if(script){script.addEventListener('load',done,{once:true});script.addEventListener('error',reject,{once:true});if(window.turnstile)done();}
    else{script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=done;script.onerror=reject;document.head.append(script);}
   });
   status.textContent='Complete verification, then send your enquiry.';
   widget=window.turnstile.render(verification,{sitekey:config.site_key,action:'enquiry',size:'flexible',callback:value=>{token=value;state();if(!busy&&!received)status.textContent='';},'expired-callback':()=>{token='';state();},'error-callback':()=>{token='';state();status.textContent='Verification failed. Please close and reopen the form to retry.';}});
  }catch(error){started=false;status.textContent=(error.name==='TimeoutError'||error.name==='AbortError')?'The enquiry form could not connect. Close and reopen to retry, or contact us by email or WhatsApp.':error.message||'Unable to load verification. Please contact us by email or WhatsApp.';}
 }
 enquire.addEventListener('click',()=>{if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');start();});
 d.addEventListener('close',()=>{if(received){f.reset();received=false;key=crypto.randomUUID();signature='';submit.textContent='Send enquiry';token='';state();}});
 document.getElementById('close-enquiry')?.addEventListener('click',()=>d.close());d.addEventListener('click',e=>{if(e.target===d)d.close();});
 f.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||received||!token||!f.reportValidity())return;
  const fields=new FormData(f);const data=Object.fromEntries(['full_name','email','phone','location','accommodation','move_in','occupants','message'].map(key=>[key,fields.get(key)||'']));const next=JSON.stringify(data);if(signature&&signature!==next)key=crypto.randomUUID();signature=next;
  busy=true;state();status.textContent='Sending your enquiry…';
  try{
   const response=await fetch('/api/enquiries',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({...data,turnstile_token:token}),signal:AbortSignal.timeout(20000)});const result=await response.json();
   if(!response.ok||result.received!==true)throw Error(result.error||'Receipt could not be confirmed. Keep your details and try again.');
   received=true;submit.textContent='Enquiry received';status.textContent=result.message+' Reference: '+result.reference;
  }catch(error){status.textContent=error.message||'Receipt could not be confirmed. Keep your details and try again.';token='';if(window.turnstile&&widget!==undefined)window.turnstile.reset(widget);}
  finally{busy=false;state();}
 });
 const palette=document.getElementById('contact-palette'),hide=document.getElementById('contact-palette-close'),show=document.getElementById('contact-palette-open');if(!palette||!hide||!show)return;
 const setExpanded=expanded=>{palette.hidden=!expanded;show.hidden=expanded;hide.setAttribute('aria-expanded',String(expanded));show.setAttribute('aria-expanded',String(expanded));};hide.addEventListener('click',()=>setExpanded(false));show.addEventListener('click',()=>setExpanded(true));
})();
