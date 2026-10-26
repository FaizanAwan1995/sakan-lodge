export const MAX_ROOM_PHOTOS=20;
export function roomPhotoFileError(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))return 'Choose JPG, PNG or WebP photos. Convert HEIC photos to JPG first.';
 if(!file.size||file.size>20*1024*1024)return 'Choose a photo smaller than 20 MB.';
 return '';
}
export async function prepareRoomPhoto(file){
 const error=roomPhotoFileError(file);if(error)throw Error(error);
 const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
 try{const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));if(!blob||blob.size>5*1024*1024)throw Error('Unable to prepare this photo. Choose a smaller JPG.');return blob;}finally{bitmap.close();}
}
