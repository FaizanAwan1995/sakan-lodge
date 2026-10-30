import {useEffect,useRef,useState} from 'react';
import {supabase,isLocalMode} from '../../store.js';
import RoomPhotos from '../rooms/RoomPhotos.jsx';
import {uploadRoomPhotoBatch,MAX_ROOM_PHOTOS,ROOM_PHOTO_ACCEPT} from '../../room-photo-upload.js';
import {segmentRooms} from '../../segment-photo-model.js';
const labels={men:'Men',women:'Women',couples:'Couples'};
export default function WebsitePhotos({db}){
 const [segment,setSegment]=useState('women'),[mode,setMode]=useState('segment'),[busy,setBusy]=useState(false),[profiles,setProfiles]=useState([]),[roomProfiles,setRoomProfiles]=useState([]),[error,setError]=useState(''),[roomId,setRoomId]=useState('');
 useEffect(()=>{if(isLocalMode)return;let alive=true;(async()=>{try{const [p,r]=await Promise.all([supabase.from('property_profiles').select('property_id,suburb,public_name'),supabase.from('room_profiles').select('room_id,slug')]);if(p.error||r.error)throw p.error||r.error;if(alive){setProfiles(p.data||[]);setRoomProfiles(r.data||[]);}}catch(e){if(alive)setError(e.message||'Unable to load properties.');}})();return()=>{alive=false;};},[]);
 const rooms=segmentRooms(segment,db.rooms,profiles,roomProfiles),room=rooms.find(r=>r.id===roomId);
 if(isLocalMode)return <section className="card"><h1>Website photos</h1><p>Sign in to the shared Ledger to manage public photos.</p></section>;
 return <section className="website-photos" aria-label="Website photo management">
  <h1>Website photos</h1><p>Choose a segment, then update its feature photos or an individual room gallery.</p>
  <div className="website-photo-filters"><label>Accommodation segment<select value={segment} disabled={busy} onChange={e=>{setSegment(e.target.value);setRoomId('');}}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Photo gallery<select value={mode} disabled={busy} onChange={e=>setMode(e.target.value)}><option value="segment">Segment photos</option><option value="room">Room photos · bulk upload</option></select></label></div>
  {error&&<p role="alert" className="err">{error}</p>}
  {mode==='segment'?<SegmentGallery key={segment} segment={segment} onBusy={setBusy}/>:<>
   <p>Choose a room and upload several photos at once. Each batch saves only to that room.</p>
   <label>Room<select value={room?.id||''} disabled={busy} onChange={e=>setRoomId(e.target.value)}><option value="">Choose a room</option>{rooms.map(r=><option key={r.id} value={r.id}>{profiles.find(p=>p.property_id===r.property_id)?.public_name||db.properties.find(p=>p.id===r.property_id)?.name} · {r.label}</option>)}</select></label>
   {!rooms.length&&!error&&<p>No rooms match this segment. The Couples segment uses the Fulham granny flat.</p>}
   {room&&<RoomPhotos key={room.id} room={room} onBusy={setBusy}/>}
  </>}
 </section>;
}
function SegmentGallery({segment,onBusy}){
 const [profile,setProfile]=useState(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[approved,setApproved]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[queue,setQueue]=useState([]);
 const input=useRef(null),filesInput=useRef(null),working=useRef(false),urls=useRef([]);
 const photos=profile?.photos||[],pending=queue.filter(item=>item.state!=='saved');
 const fetchGallery=async()=>{const r=await supabase.from('accommodation_segment_photos').select('*').eq('segment',segment).single();if(r.error)throw r.error;return r.data;};
 async function load(){setError('');try{setProfile(await fetchGallery());setLoaded(true);}catch(e){setLoaded(false);setError(e.message||'Unable to load gallery.');}}
 useEffect(()=>{load();return()=>{urls.current.forEach(URL.revokeObjectURL);};},[segment]);
 function clear(){urls.current.forEach(URL.revokeObjectURL);urls.current=[];setQueue([]);}
 function setWorking(value){working.current=value;setBusy(value);onBusy(value);}
 async function save(next,revision){const r=await supabase.rpc('save_segment_photos',{p_segment:segment,p_photos:next,p_revision:revision});if(r.error)throw r.error;return r.data;}
 async function run(items){
  if(working.current||!approved)return;setWorking(true);setError('');setStatus('Preparing upload…');
  try{
   const latest=await fetchGallery();setProfile(latest);setLoaded(true);
   const result=await uploadRoomPhotoBatch({items,profile:latest,upload:async blob=>{const bucket=supabase.storage.from('segment-photos'),path=`${segment}/${crypto.randomUUID()}.jpg`;const r=await bucket.upload(path,blob,{contentType:'image/jpeg',cacheControl:'3600',upsert:false});if(r.error)throw r.error;return bucket.getPublicUrl(path).data.publicUrl;},save,onSaved:setProfile,onProgress:rows=>{setQueue(rows);setStatus(`${rows.filter(r=>r.state==='saved').length} of ${rows.length} photos saved.`);}});
   setQueue(result.items);setProfile(result.profile);setLoaded(!result.needsReload);
   if(result.needsReload)setError('The last save could not be confirmed or another admin changed the gallery. Retry remaining photos to reload safely.');
   if(result.items.every(item=>item.state==='saved')){clear();setStatus('Photos saved. The homepage and segment page now use this gallery.');}
  }catch(e){setLoaded(false);setError(e.message||'Upload could not be confirmed. Retry remaining photos.');}
  finally{setWorking(false);}
 }
 function upload(event){const files=Array.from(event.target.files||[]);event.target.value='';if(!files.length||working.current||!approved)return;if(files.length+photos.length>MAX_ROOM_PHOTOS){setError(`Choose up to ${MAX_ROOM_PHOTOS-photos.length} more photos.`);return;}const items=files.map(file=>{const preview=URL.createObjectURL(file);urls.current.push(preview);return{id:crypto.randomUUID(),file,preview,state:'queued'};});setQueue(items);run(items);}
 async function change(next){if(working.current)return;setWorking(true);setError('');try{const updated=await save(next,profile.revision);setProfile(updated);setStatus('Gallery saved.');}catch(e){setLoaded(false);setError(e.message||'Unable to save gallery. Reload before trying again.');}finally{setWorking(false);}}
 const disabled=busy||!loaded||!approved||pending.length>0;
 return <section className="room-photo-editor" aria-label={`${labels[segment]} segment photos`}>
  <div className="between"><h2>{labels[segment]} segment photos</h2><button type="button" disabled={busy} onClick={load}>Reload gallery</button></div>
  <p>The first photo is the cover. Changes appear on the homepage card and this segment’s page. Room listing photos are managed separately above.</p>
  <p><a href={`/accommodation/${segment}/`} target="_blank" rel="noopener noreferrer">Preview public page ↗</a></p>
  <label className="room-photo-consent"><input type="checkbox" checked={approved} disabled={busy} onChange={e=>setApproved(e.target.checked)}/> I approve these photos for the public website.</label>
  {error&&<p className="err" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  {!photos.length&&loaded&&<p>No photos yet. Add photos below.</p>}
  <div className="room-photo-grid">{photos.map((url,i)=><article key={url}><img src={url} alt={`${labels[segment]} photo ${i+1}`} loading="lazy"/><strong>{i===0?'Cover photo':`Photo ${i+1}`}</strong><div>{i>0&&<button type="button" className="small" disabled={disabled} onClick={()=>change([url,...photos.filter(p=>p!==url)])}>Make cover</button>}{i>0&&<button type="button" className="small" disabled={disabled} onClick={()=>{const next=[...photos];[next[i-1],next[i]]=[next[i],next[i-1]];change(next);}}>Move earlier</button>}<button type="button" className="small" disabled={disabled} onClick={()=>{if(confirm('Remove this photo from the segment gallery?'))change(photos.filter(p=>p!==url));}}>Remove</button></div></article>)}
   {pending.map(item=><article key={item.id}><img src={item.preview} alt={`Selected: ${item.file.name}`}/><strong>{item.file.name}</strong><small>{item.error||item.state}</small></article>)}
   <button type="button" className="room-photo-add" disabled={disabled||photos.length>=MAX_ROOM_PHOTOS} onClick={()=>input.current?.click()}><span aria-hidden="true">＋</span>{busy?'Uploading…':'Add photos'}</button>
  </div>
  {!!pending.length&&!busy&&<div className="account-actions"><button type="button" disabled={!approved} onClick={()=>run(queue)}>Retry remaining photos</button><button type="button" onClick={()=>{clear();setStatus('Unsaved selection cleared. Saved photos remain.');}}>Clear unsaved selection</button></div>}
  <button type="button" disabled={disabled||photos.length>=MAX_ROOM_PHOTOS} onClick={()=>filesInput.current?.click()}>Choose from Files</button>
  <input ref={input} type="file" accept={ROOM_PHOTO_ACCEPT} multiple hidden onChange={upload}/><input ref={filesInput} type="file" multiple hidden onChange={upload}/>
  <p className="muted">Select multiple photos in one picker. Up to 20 photos per gallery. Uploading photos does not change room availability or publish an unapproved listing.</p>
 </section>;
}
