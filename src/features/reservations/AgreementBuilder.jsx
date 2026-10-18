import { useEffect, useState } from 'react';
import { supabase } from '../../store.js';
export default function AgreementBuilder({ reservation, busy, run }) {
  const [templates,setTemplates]=useState([]),[error,setError]=useState('');
  const [template,setTemplate]=useState({title:'',terms:'',proprietor:{name:'',address:'',phone:''}});
  const [form,setForm]=useState({template_id:'',premises_address:'',term_description:`${reservation.arrival_date} to ${reservation.departure_date}`,resident_names:reservation.full_name,first_rent_due:reservation.arrival_date,bond:reservation.weekly_rate*2,nightly_rate:''});
  const nightly=(Date.parse(reservation.departure_date)-Date.parse(reservation.arrival_date))/86400000<7;
  const update=(key,value)=>setForm(old=>({...old,[key]:value}));
  async function load(){const {data,error}=await supabase.from('agreement_templates').select('*').order('approved_at',{ascending:false});if(error)throw error;setTemplates(data);}
  useEffect(()=>{let current=true;supabase.from('agreement_templates').select('*').order('approved_at',{ascending:false}).then(({data,error})=>{if(current){if(error)setError(error.message);else setTemplates(data);}});return()=>{current=false;};},[]);
  return <div className="card">
    <h4>Reusable private agreement</h4>
    <p>Choose an approved template. Applicant details, premises, rates and fresh signature spaces are frozen into a new agreement version. Existing agreements are unchanged.</p>
    {error&&<p role="alert">{error}</p>}
    <details><summary>Import or approve a reusable template</summary>
      <p>Import the prepared private JSON, review its terms and proprietor details, then approve. No existing signature or applicant details are imported.</p>
      <input type="file" accept=".json,application/json" aria-label="Import private agreement template" disabled={busy} onChange={async e=>{try{const file=e.target.files?.[0];if(!file)return;if(file.size>100000)throw Error('Template file too large');const data=JSON.parse(await file.text());if(typeof data.title!=='string'||typeof data.terms!=='string'||!data.proprietor)throw Error('Invalid template');setTemplate({title:data.title,terms:data.terms,proprietor:{name:String(data.proprietor.name||''),address:String(data.proprietor.address||''),phone:String(data.proprietor.phone||'')}});setError('');}catch(error){setError(error.message);}}}/>
      <label>Template reference<input value={template.title} maxLength={160} onChange={e=>setTemplate({...template,title:e.target.value})}/></label>
      {['name','address','phone'].map(key=><label key={key}>Proprietor {key}<input value={template.proprietor[key]} onChange={e=>setTemplate({...template,proprietor:{...template.proprietor,[key]:e.target.value}})}/></label>)}
      <label>Reviewed reusable terms<textarea rows={12} maxLength={30000} value={template.terms} onChange={e=>setTemplate({...template,terms:e.target.value})}/></label>
      <button disabled={busy||template.terms.length<40||!template.title} onClick={()=>{if(confirm('Approve these reviewed terms and proprietor details as a new private reusable template?'))run(async()=>{const {data,error}=await supabase.rpc('approve_agreement_template',{p_data:{...template,confirmation:'APPROVE_REUSABLE_TEMPLATE'}});if(error)throw error;await load();update('template_id',data.id);});}}>Approve new template version</button>
    </details>
    <label>Approved template<select value={form.template_id} onChange={e=>update('template_id',e.target.value)}><option value="">Choose reviewed template</option>{templates.map(t=><option key={t.id} value={t.id}>{t.title} · {t.approved_at.slice(0,10)}</option>)}</select></label>
    {templates.find(t=>t.id===form.template_id)&&<details><summary>Review selected template terms</summary><pre style={{whiteSpace:'pre-wrap'}}>{templates.find(t=>t.id===form.template_id).terms}</pre></details>}
    <label>Verified premises address<input value={form.premises_address} onChange={e=>update('premises_address',e.target.value)}/></label>
    <label>Agreement term description<input value={form.term_description} onChange={e=>update('term_description',e.target.value)}/></label>
    <label>Resident names, one per line<textarea value={form.resident_names} onChange={e=>update('resident_names',e.target.value)}/></label>
    <label>First rent due<input type="date" value={form.first_rent_due} onChange={e=>update('first_rent_due',e.target.value)}/></label>
    <label>Agreed bond per resident (AUD)<input type="number" min="0" step="0.01" value={form.bond} onChange={e=>update('bond',e.target.value)}/></label>
    {nightly&&<label>Explicit agreed nightly rent per resident (AUD)<input type="number" min="0.01" step="0.01" value={form.nightly_rate} onChange={e=>update('nightly_rate',e.target.value)}/></label>}
    <p>Utilities are included without additional charges. {nightly?'A nightly rate requires approval and fresh signatures; it is never calculated from the weekly quote.':'Rent is paid fortnightly in advance on the house cycle.'}</p>
    <button disabled={busy||!form.template_id||!form.premises_address||form.bond===''||(nightly&&!form.nightly_rate)} onClick={()=>run(async()=>{const {error}=await supabase.rpc('create_template_contract',{p_res:reservation.id,p_data:{...form,revision:reservation.revision,resident_names:form.resident_names.split('\n').map(s=>s.trim()).filter(Boolean)}});if(error)throw error;})}>Generate agreement draft</button>
  </div>;
}
