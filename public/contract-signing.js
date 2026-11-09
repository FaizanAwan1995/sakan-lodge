/* Token stays in the URL fragment and memory; no analytics or persistent browser storage. */
(() => {
  const token=location.hash.slice(1);
  const status=document.getElementById('signing-status'),content=document.getElementById('signing-content'),retry=document.getElementById('retry-load');
  let snapshot,busy=false,loading=false,poll;
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const money=n=>'AUD $'+Number(n).toFixed(2);
  async function api(action,data={}) {
    const r=await fetch('/api/contract-signing/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Signing-Token':token},body:JSON.stringify(data),signal:AbortSignal.timeout(action==='submit'?60000:20000)});
    if(!r.ok){const out=await r.json().catch(()=>({}));throw Error(out.error||'This action could not be completed. Please retry.');}
    return action==='document'?r.blob():r.json();
  }
  async function download(signed,button) {
    button.disabled=true;
    try{const blob=await api('document',{signed});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=signed?'SAKAN-signed-agreement.pdf':'SAKAN-agreement.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
    catch(e){status.textContent=e.message;}finally{button.disabled=false;}
  }
  function documentButton(signed) {const b=el('button',signed?'Download your signed copy':'Download original agreement');b.type='button';b.addEventListener('click',()=>download(signed,b));return b;}
  function facts(a) {
    const box=el('section',undefined,'signing-card');box.append(el('h2','Your stay'));
    const list=el('dl',undefined,'signing-facts');
    for(const [label,value] of [['Resident(s)',a.resident_names.join('; ')],['Proprietor',a.proprietor?.name],['Proprietor address',a.proprietor?.address],['Proprietor contact',a.proprietor?.phone],['Applicant email',a.email],['Applicant phone',a.phone],['Premises',a.premises_address],['Room',a.room_label],['Check-in',a.arrival_date],['Checkout',a.departure_date],['Agreed term',a.term_description],['Rent',a.billing_type==='nightly'?money(a.nightly_rate)+' / night per resident':money(a.weekly_rate)+' / week'+(a.offer_type==='shared'?' per resident':'')],['Bond per resident',money(a.bond)],['First rent due',a.first_rent_due],['Payment',a.payment_instructions],['Utilities',a.utilities]]){const row=el('div');row.append(el('dt',label),el('dd',value||'As stated in the agreement'));list.append(row);}
    box.append(list,documentButton(false));return box;
  }
  function signatureField(name) {
    const field=el('fieldset'),legend=el('legend',name);field.append(legend);
    const label=el('label','Type your full name as shown in the agreement'),input=el('input');input.required=true;input.maxLength=160;input.autocomplete='name';input.addEventListener('input',()=>input.setCustomValidity(''));label.append(input);
    const modeLabel=el('label','Signature method'),mode=el('select');for(const [value,text] of [['typed','Use my typed name as my signature'],['drawn','Draw my signature']]){const option=el('option',text);option.value=value;mode.append(option);}modeLabel.append(mode);
    const drawing=el('div');drawing.hidden=true;
    const help=el('p','Draw with your finger, stylus or mouse. You can use a typed signature instead.', 'signature-help'),canvas=el('canvas',undefined,'signature-canvas');canvas.width=1000;canvas.height=280;canvas.setAttribute('aria-label','Draw signature for '+name);
    const clear=el('button','Clear drawing');clear.type='button';drawing.append(help,canvas,clear);
    const ctx=canvas.getContext('2d');ctx.lineWidth=4;ctx.lineCap='round';ctx.strokeStyle='#173d32';let strokes=[],stroke=null;
    const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
    canvas.addEventListener('pointerdown',e=>{if(strokes.length>=50)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);stroke=[point(e)];strokes.push(stroke);});
    canvas.addEventListener('pointermove',e=>{if(!stroke)return;e.preventDefault();if(strokes.reduce((n,s)=>n+s.length,0)>=1500)return;const p=point(e),old=stroke[stroke.length-1];ctx.beginPath();ctx.moveTo(old[0]*1000,old[1]*280);ctx.lineTo(p[0]*1000,p[1]*280);ctx.stroke();stroke.push(p);});
    const end=()=>{if(stroke&&stroke.length<2)strokes=strokes.filter(s=>s!==stroke);stroke=null;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    clear.addEventListener('click',()=>{ctx.clearRect(0,0,1000,280);strokes=[];stroke=null;});mode.addEventListener('change',()=>drawing.hidden=mode.value!=='drawn');
    const consentLabel=el('label',undefined,'signing-consent'),consent=el('input');consent.type='checkbox';consent.required=true;consentLabel.append(consent,el('span','I am '+name+'. I have read the agreement, agree to its terms and consent to signing electronically. This signature is my own.'));
    field.append(label,modeLabel,drawing,consentLabel);
    return {field,validate:()=>{const normal=n=>n.trim().replace(/\s+/g,' ').toLowerCase();input.setCustomValidity(normal(input.value)===normal(name)?'':'Enter your full name exactly as shown in the agreement.');if(mode.value==='drawn'&&!strokes.some(s=>s.length>1)){status.textContent='Please draw your signature or choose a typed signature.';return false;}return input.reportValidity();},read:()=>({name:input.value,mode:mode.value,consent:consent.checked,strokes:mode.value==='drawn'?strokes:[]})};
  }
  async function submit(signatures,button,form) {
    if(busy)return;busy=true;button.disabled=true;status.textContent='Saving your signed agreement. Please keep this page open…';form?.setAttribute('aria-busy','true');form?.querySelectorAll('fieldset').forEach(f=>f.disabled=true);
    try{snapshot=await api('submit',{document_hash:snapshot.request.document_hash,consent_version:'sakan-sign-v1',signatures});render();status.scrollIntoView({block:'start'});}
    catch(e){status.textContent=e.name==='TimeoutError'?'Your submission could not be confirmed. Retry with the same signatures; this will not create a duplicate.':e.message;status.scrollIntoView({block:'center'});}
    finally{busy=false;button.disabled=false;form?.removeAttribute('aria-busy');form?.querySelectorAll('fieldset').forEach(f=>f.disabled=false);}
  }
  function render() {
    clearTimeout(poll);content.replaceChildren();content.hidden=false;retry.hidden=true;
    const {request:r,agreement:a,reference}=snapshot;
    content.append(el('p',reference+' · Agreement version '+a.version));
    if(['signed','approved','rejected','superseded'].includes(r.status)) {
      const messages={signed:'Your signatures have been received. The SAKAN team will review them and confirm room availability before approving your allocation.',approved:'Your signed agreement has been approved by the SAKAN team.',rejected:'The SAKAN team has declined this request. Contact the team if you have questions.',superseded:'This agreement has been replaced. Ask SAKAN for the latest signing link.'};
      status.textContent=messages[r.status];
      content.append(facts(a));
      if(r.status==='signed'){content.append(el('p','You have finished signing. Our team reviews your agreement next. We will email you after approving or declining your request. You do not need to reply with the PDF.','signing-notice'));poll=setTimeout(()=>{if(!document.hidden&&!busy)load();},30000);}
      if(r.status==='approved')content.append(el('p','Your room is allocated. Contact our team to arrange arrival and key collection. Rent and bond payment are handled separately; this approval does not acknowledge a payment.','signing-notice'));
      const refresh=el('button','Refresh review status');refresh.type='button';refresh.addEventListener('click',load);content.append(refresh);
      if(r.status==='rejected')content.append(el('p','Please do not make payments for this declined request. Contact our team if you need to discuss your options.','signing-notice'));
      if(r.review_reason)content.append(el('p',r.review_reason,'signing-notice'));
      if(r.can_download_signed)content.append(documentButton(true),el('p','Save your signed copy now. This private link expires '+new Date(r.expires_at).toLocaleString('en-AU')+'.'));
      return;
    }
    content.append(el('p','Read every part of the agreement before signing. Incorrect details? Contact our team first.','signing-notice'),facts(a));
    const terms=el('section',undefined,'signing-card');terms.append(el('h2','Terms and house rules'),el('div',a.terms,'agreement-terms'));content.append(terms);
    if(r.status==='processing') {
      status.textContent='Your signature submission is being prepared. Retry to finish saving the same signed copy.';
      const resume=el('button','Retry signature submission','primary');resume.type='button';resume.addEventListener('click',()=>submit(r.signatures,resume));content.append(resume);return;
    }
    status.textContent='Private link expires '+new Date(r.expires_at).toLocaleString('en-AU')+'.';
    const form=el('form',undefined,'signing-card');form.append(el('h2','Resident signatures'),el('p','Each named resident must complete their own signature below. Submitting signatures does not reserve a room or confirm allocation. Our administrators review the signed agreement next.'));
    const fields=a.resident_names.map(name=>signatureField(name));for(const f of fields)form.append(f.field);
    const button=el('button','Sign and send for admin review','primary');button.type='submit';form.append(button);
    form.addEventListener('submit',e=>{e.preventDefault();if(form.reportValidity()&&fields.every(f=>f.validate()))submit(fields.map(f=>f.read()),button,form);});content.append(form);
  }
  async function load() {
    if(loading||busy)return;loading=true;retry.hidden=true;if(!snapshot)status.textContent='Opening your private agreement…';
    if(!/^[0-9a-f]{64}$/.test(token)){status.textContent='Open the complete signing link from your SAKAN email. If it has expired, ask our team for a new link.';loading=false;return;}
    try{snapshot=await api('access');render();}catch(e){status.textContent=e.message||'Unable to open this agreement.';retry.hidden=false;}finally{loading=false;}
  }
  retry.addEventListener('click',load);window.addEventListener('hashchange',()=>location.reload());document.addEventListener('visibilitychange',()=>{if(!document.hidden&&snapshot?.request.status==='signed'&&!busy)load();});load();
})();
