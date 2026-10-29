export const MAX_ROOM_PHOTOS=20;
export const ROOM_PHOTO_ACCEPT='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
export function roomPhotoFileError(file){
 const supported=['image/jpeg','image/png','image/webp','image/heic','image/heif'];
 if(!supported.includes(file.type)&&!(file.type===''&&/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name||'')))return 'Choose JPG, PNG, WebP or iPhone HEIC photos.';
 if(!file.size||file.size>20*1024*1024)return 'Choose a photo smaller than 20 MB.';
 return '';
}
export async function prepareRoomPhoto(file){
 const error=roomPhotoFileError(file);if(error)throw Error(error);
 const url=URL.createObjectURL(file),img=new Image();
 let timer;
 try{
  await new Promise((resolve,reject)=>{timer=setTimeout(()=>{img.src='';reject(Error('Photo loading timed out. Open it in Photos to download the original, then try one photo or Choose from Files.'));},30000);img.onload=()=>{clearTimeout(timer);resolve();};img.onerror=()=>{clearTimeout(timer);reject(Error('This browser could not read the photo. Export it as JPG from Photos or Files, then try again.'));};img.src=url;});
  const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('Unable to prepare photo. Try a smaller JPG.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Photo preparation timed out. Try a smaller JPG.')),15000);canvas.toBlob(value=>{clearTimeout(timer);resolve(value);},'image/jpeg',.85);});
  if(!blob||blob.size>5*1024*1024)throw Error('Unable to prepare this photo. Choose a smaller JPG.');return blob;
 }finally{clearTimeout(timer);img.onload=null;img.onerror=null;URL.revokeObjectURL(url);}
}

/** Save each photo separately, carrying the server revision between writes. */
export async function uploadRoomPhotoBatch({items,profile,prepare=prepareRoomPhoto,upload,save,onProgress=()=>{},onSaved=()=>{}}){
 const queue=items.map(item=>({...item,state:item.state || 'queued'}));let current=profile,needsReload=false;
 const update=(item,state,error='')=>{item.state=state;item.error=error;onProgress(queue.map(row=>({...row})));};
 for(const item of queue){
  if(item.state==='saved')continue;
  if(item.url&&(current?.photos || []).includes(item.url)){update(item,'saved');continue;}
  if((current?.photos || []).length>=MAX_ROOM_PHOTOS){update(item,'failed','The room gallery is full (20 photos). Remove a photo before retrying.');continue;}
  let stage='preparing';
  try{
   if(!item.url){update(item,'preparing');const blob=await prepare(item.file);stage='uploading';update(item,'uploading');item.url=await upload(blob,item);}
   stage='saving';update(item,'saving');
   current=await save([...(current?.photos || []),item.url],current?.revision ?? null);
   update(item,'saved');onSaved(current);
  }catch(e){
   update(item,'failed',e.message || 'Unable to save this photo.');
   // A failed gallery response may have committed, or another admin may have edited.
   // Reload before retrying; the retained URL lets us recognise an already-saved photo.
   if(stage==='saving'){needsReload=true;break;}
  }
 }
 return {profile:current,items:queue,needsReload};
}
