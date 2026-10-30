/** Keep auth callbacks synchronous; Supabase holds an auth lock while notifying them. */
export function startSessionResume({auth,onSession,onError=()=>{},window:win,document:doc,timeoutMs=15000}){
 let active=true,running=false,version=0,signOutVersion=0;const timers=new Set();
 const accept=session=>{if(active){version++;onSession(session??null);onError(null);}};
 const subscription=auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'){signOutVersion++;accept(null);}
  else if(event!=='INITIAL_SESSION'&&session)accept(session);
 });
 const timed=promise=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{timers.delete(timer);reject(Error('Session check timed out'));},timeoutMs);timers.add(timer);promise.then(value=>{clearTimeout(timer);timers.delete(timer);resolve(value);},error=>{clearTimeout(timer);timers.delete(timer);reject(error);});});
 const check=async()=>{
  if(!active||running||doc.visibilityState==='hidden')return;running=true;let checkedVersion=version;const signOutAtStart=signOutVersion;
  try{
   const result=await timed(auth.getSession());if(result.error)throw result.error;
   if(!active||signOutAtStart!==signOutVersion)return;
   checkedVersion=version;let session=result.data?.session??null;
   if(session){const verified=await timed(auth.getUser());if(verified.error)throw verified.error;if(!verified.data?.user)session=null;}
   if(active&&checkedVersion===version)accept(session);
  }catch(error){if(active&&checkedVersion===version){if([400,401,403].includes(Number(error.status))||/refresh_token_not_found|refresh_token_already_used|session_not_found|bad_jwt/.test(error.code||''))accept(null);else onError('Unable to reconnect. Check your connection and try again.');}}
  finally{running=false;}
 };
 const onReturn=()=>{void check();};
 win.addEventListener('focus',onReturn);win.addEventListener('online',onReturn);win.addEventListener('pageshow',onReturn);doc.addEventListener('visibilitychange',onReturn);
 void check();
 return {check,stop(){active=false;version++;subscription.data.subscription.unsubscribe();timers.forEach(clearTimeout);win.removeEventListener('focus',onReturn);win.removeEventListener('online',onReturn);win.removeEventListener('pageshow',onReturn);doc.removeEventListener('visibilitychange',onReturn);}};
}
