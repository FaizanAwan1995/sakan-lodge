/* Optional Google Ads measurement. No network activity without consent and a verified destination. */
export function createEnquiryMeasurement(destination, root = window, doc = document) {
 if (!/^AW-[0-9]+\/[A-Za-z0-9_-]+$/.test(destination || '')) return null;
 const tagId = destination.split('/')[0], sent = new Set();
 let allowed = false, loaded = false;
 function gtag(){ root.dataLayer = root.dataLayer || []; root.dataLayer.push(arguments); }
 function consent(value) {
  allowed = value === true;
  if (!allowed && !loaded) return;
  if (!loaded) {
   loaded = true;
   gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});
   gtag('js',new Date());
   gtag('config',tagId,{send_page_view:false,allow_ad_personalization_signals:false});
   const script=doc.createElement('script'); script.async=true;
   script.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(tagId);doc.head.append(script);
  }
  gtag('consent','update',{ad_storage:allowed?'granted':'denied',ad_user_data:allowed?'granted':'denied',ad_personalization:'denied',analytics_storage:'denied'});
 }
 function received(id) {
  if (!allowed || !/^[a-f0-9-]{36}$/i.test(id || '') || sent.has(id)) return false;
  sent.add(id);
  gtag('event','conversion',{send_to:destination,transaction_id:id});
  return true;
 }
 return {consent,received};
}
