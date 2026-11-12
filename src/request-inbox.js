export const inboxSection=row=>row.kind==='reservation'?'reservations':'enquiries';
export const noticeKey=row=>row.kind==='email'||row.activity_at&&row.activity_at!==row.created_at?row.id+':'+(row.activity_at||row.created_at):row.id;
export function requestDestination(row){
 if(row.kind==='reservation')return '/reservations?reservation='+encodeURIComponent(row.id);
 return '/enquiries?'+(row.kind==='email'||row.thread_id?'id='+encodeURIComponent(row.thread_id||row.id):'website='+encodeURIComponent(row.id));
}
export function inboxCounts(rows,seen=[]){
 const read=new Set(seen);return Object.fromEntries(['reservations','enquiries'].map(section=>{const items=rows.filter(r=>inboxSection(r)===section);return [section,{total:items.length,unread:items.filter(r=>!read.has(noticeKey(r))).length}];}));
}
export function markSectionRead(rows,seen,section){return [...new Set([...seen,...rows.filter(r=>inboxSection(r)===section).map(noticeKey)])].slice(-500);}
export function combineRequests(reservations,websites,threads){
 const websiteThreads=new Map(threads.filter(t=>t.website_enquiry_id).map(t=>[t.website_enquiry_id,t]));
 return [...reservations.map(r=>({...r,kind:'reservation',name:r.full_name,reference:r.reservation_code})),...websites.filter(r=>websiteThreads.get(r.id)?.status!=='closed').map(r=>({...r,kind:'enquiry',name:r.details.full_name,thread_id:websiteThreads.get(r.id)?.id,activity_at:websiteThreads.get(r.id)?.last_message_at||r.created_at,reference:r.reference})),...threads.filter(t=>t.source==='email'&&t.status!=='closed').map(t=>({...t,kind:'email',name:t.contact_name||t.contact_email,reference:t.subject,created_at:t.last_message_at}))].sort((a,b)=>(b.activity_at||b.created_at).localeCompare(a.activity_at||a.created_at));
}
