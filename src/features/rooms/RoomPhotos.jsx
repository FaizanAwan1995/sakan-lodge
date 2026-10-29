import {Link} from 'react-router-dom';
import {useEffect,useRef,useState} from 'react';
import {supabase,isLocalMode} from '../../store.js';
import {uploadRoomPhotoBatch,MAX_ROOM_PHOTOS,ROOM_PHOTO_ACCEPT} from '../../room-photo-upload.js';
export default function RoomPhotos({room,onBusy}){
 const [profile,setProfile]=useState(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[approved,setApproved]=useState(false),[queue,setQueue]=useState([]);
 const input=useRef(null),singleInput=useRef(null),filesInput=useRef(null),saving=useRef(false),previewUrls=useRef([]);
 const photos=profile?.photos || [],pending=queue.filter(item=>item.state!=='saved');
 async function fetchProfile(){const r=await supabase.from('room_profiles').select('*').eq('room_id',room.id).maybeSingle();if(r.error)throw r.error;return r.data;}
 async function load(){setError('');setLoaded(false);try{setProfile(await fetchProfile());setLoaded(true);}catch(e){setError(e.message||'Unable to load room photos.');}}
 function clearQueue(){previewUrls.current.forEach(url=>URL.revokeObjectURL(url));previewUrls.current=[];setQueue([]);}
 useEffect(()=>{if(!isLocalMode&&room.id)load();return()=>{previewUrls.current.forEach(url=>URL.revokeObjectURL(url));previewUrls.current=[];};},[room.id]);
 function working(value){saving.current=value;setBusy(value);onBusy?.(value);}
 async function save(next,revision){const r=await supabase.rpc('save_room_photos',{p_room:room.id,p_photos:next,p_revision:revision});if(r.error)throw r.error;return r.data;}
 async function run(items){
  if(saving.current||!approved)return;
  working(true);setError('');setStatus('Loading the latest gallery…');setQueue(items);
  try{
   const latest=await fetchProfile();setProfile(latest);setLoaded(true);
   const result=await uploadRoomPhotoBatch({items,profile:latest,
    upload:async blob=>{const path=`${room.id}/${crypto.randomUUID()}.jpg`;const bucket=supabase.storage.from('room-photos');const r=await bucket.upload(path,blob,{contentType:'image/jpeg',cacheControl:'3600',upsert:false});if(r.error)throw r.error;return bucket.getPublicUrl(path).data.publicUrl;},
    save,onSaved:setProfile,onProgress:rows=>{setQueue(rows);const active=rows.find(r=>['preparing','uploading','saving'].includes(r.state));const done=rows.filter(r=>r.state==='saved').length;setStatus(active?`${done} of ${rows.length} saved · ${active.state==='preparing'?'Preparing':active.state==='uploading'?'Uploading':'Saving'} ${active.file.name}…`:`${done} of ${rows.length} photos saved.`);}});
   setQueue(result.items);setProfile(result.profile);setLoaded(!result.needsReload);
   const saved=result.items.filter(r=>r.state==='saved').length,remaining=result.items.length-saved;
   setStatus(`${saved} of ${result.items.length} photos saved.${remaining?' Retry the remaining photos below.':' Approved, ready rooms with vacancies use this gallery on the website.'}`);
   if(result.needsReload)setError('The gallery may have changed, or the last save could not be confirmed. Retry remaining photos reloads it first and checks for already-saved images.');
   if(!remaining)clearQueue();
  }catch(e){setLoaded(false);setStatus('');setError((e.message||'Unable to load the gallery.')+' Retry remaining photos to try again.');}
  finally{working(false);}
 }
 function upload(event){
  const files=Array.from(event.target.files || []);event.target.value='';if(!files.length||saving.current||!approved)return;
  setError('');setStatus('');
  if(photos.length+files.length>MAX_ROOM_PHOTOS){setError(`This room has space for ${MAX_ROOM_PHOTOS-photos.length} more photo(s), up to 20 total.`);return;}
  if(pending.length){setError('Retry or clear the remaining selection before choosing more photos.');return;}
  const items=files.map(file=>{const preview=URL.createObjectURL(file);previewUrls.current.push(preview);return {id:crypto.randomUUID(),file,preview,state:'queued'};});
  run(items);
 }
 async function change(next){if(saving.current)return;working(true);setError('');setStatus('');try{const updated=await save(next,profile?.revision ?? null);setProfile(updated);setStatus('Gallery saved.');}catch(e){setError(e.message||'Unable to update gallery.');setLoaded(false);}finally{working(false);}}
 if(!room.id)return <section className="room-photo-editor"><h2>Room photos</h2><p>Save this new room first, then reopen it to add photos.</p></section>;
 if(isLocalMode)return <section className="room-photo-editor"><h2>Room photos</h2><p>Sign in to the shared ledger to upload room photos.</p></section>;
 const disabled=busy||!approved||!loaded||photos.length>=MAX_ROOM_PHOTOS||pending.length>0;
 return <section className="room-photo-editor" aria-label="Room photos">
  <div className="between"><h2>Room photos</h2><button type="button" className="small" disabled={busy} onClick={load}>Reload gallery</button></div>
  <p>Select several photos together, then confirm your selection once. They save individually to this room. The first photo is the main image; approved, ready listings use the gallery when a bed is available.</p>
  <p className="muted">Uploads are public images. Check that no residents, documents or personal details are visible. Adding photos does not publish an unapproved room.</p>
  {loaded&&!profile?.published&&<p>This room is not published. <Link to="/reservations">Review and approve its public listing</Link> before it appears on the website.</p>}
  <label className="room-photo-consent"><input type="checkbox" checked={approved} disabled={busy} onChange={e=>setApproved(e.target.checked)}/> I approve these room photos for the public website.</label>
  {error&&<p className="err" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  <div className="room-photo-grid">
   {photos.map((url,i)=><article key={url+'-'+i}><img src={url} alt={`${room.label} photo ${i+1}`} loading="lazy"/><strong>{i===0?'Main photo':`Photo ${i+1}`}</strong><div>{i>0&&<button type="button" className="small" disabled={busy||!approved||!loaded||pending.length>0} onClick={()=>change([url,...photos.filter((_,n)=>n!==i)])}>Make main</button>}<button type="button" className="small" disabled={busy||!approved||!loaded} onClick={()=>{if(confirm('Remove this photo from the room gallery and website listing?'))change(photos.filter((_,n)=>n!==i));}}>Remove</button></div></article>)}
   {pending.map(item=><article key={item.id}><img src={item.preview} alt={`Selected photo: ${item.file.name}`}/><strong>{item.file.name}</strong><small>{item.state==='failed'?item.error:item.state==='queued'?'Waiting…':item.state==='preparing'?'Preparing…':item.state==='uploading'?'Uploading…':'Saving…'}</small></article>)}
   <button type="button" className="room-photo-add" disabled={disabled} onClick={()=>input.current?.click()}><span aria-hidden="true">＋</span>{busy?'Uploading…':'Add photos'}</button>
  </div>
  {!!pending.length&&!busy&&<div className="account-actions"><button type="button" disabled={!approved} onClick={()=>run(queue)}>Retry remaining photos</button><button type="button" onClick={()=>{clearQueue();setError('');setStatus('Unsaved selection cleared. Photos already saved remain in the gallery.');}}>Clear unsaved selection</button></div>}
  <div className="account-actions"><button type="button" disabled={disabled} onClick={()=>singleInput.current?.click()}>Add one photo</button><button type="button" disabled={disabled} onClick={()=>filesInput.current?.click()}>Choose from Files</button></div>
  <input ref={input} type="file" accept={ROOM_PHOTO_ACCEPT} multiple hidden onChange={upload}/><input ref={singleInput} type="file" accept={ROOM_PHOTO_ACCEPT} hidden onChange={upload}/><input ref={filesInput} type="file" multiple hidden onChange={upload}/>
  <p className="muted">If the iPhone picker stays open, cancel and try Add one photo or choose several saved photos from Files. Photos only start uploading after the picker closes. Tap the tick once while iPhone prepares the originals.</p>
  <small>JPG, PNG, WebP or HEIC supported by your browser · up to 20 photos · photos save separately from room details.</small>
 </section>;
}
