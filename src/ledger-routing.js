const PAGE=/^\/(home|today|rooms|rent|expenses|reports|communications|reservations|reviews|activity|website-photos)\/?$/;
export function isLedgerPage(path){return typeof path==='string'&&(PAGE.test(path)||/^\/rooms\/[a-zA-Z0-9_-]{1,100}\/?$/.test(path));}
export function legacyLedgerPath(path){return isLedgerPage(path)||path==='/signin'?'/ledger'+path:null;}
export function ledgerBasename(path){return path==='/ledger'||path.startsWith('/ledger/')?'/ledger/':'/';}
export function readLedgerVisit(storage,userId){
 try{const value=JSON.parse(storage.getItem('sakan-ledger-visit:'+userId)||'null');
  if(!value||!isLedgerPage(value.pathname)||typeof value.search!=='string'||value.search.length>1000||!/^(?:\?[^#]*)?$/.test(value.search))return null;
  return {...value,scroll:Number.isFinite(value.scroll)?Math.min(100000,Math.max(0,value.scroll)):0};
 }catch{return null;}
}
export function saveLedgerVisit(storage,userId,pathname,search='',scroll=0){
 if(!userId||!isLedgerPage(pathname))return;
 // Persist navigation only; never OAuth codes/tokens or form contents.
 const query=new URLSearchParams(search);for(const key of [...query.keys()])if(/token|code|password|secret|error/i.test(key))query.delete(key);
 const filtered=query.toString();try{storage.setItem('sakan-ledger-visit:'+userId,JSON.stringify({pathname,search:filtered?'?'+filtered:'',scroll:Number.isFinite(scroll)?Math.max(0,scroll):0}));}catch{}
}
