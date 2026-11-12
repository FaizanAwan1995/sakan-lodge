import {signingEmailHtml} from './signing-email.js';
export const REVIEW_LINKS={google:'https://maps.app.goo.gl/GYqfd7BsjgCmsMdy9?g_st=ic',facebook:'https://www.facebook.com/SakanLodge/reviews/',website:'https://sakanlodge.com/#leave-review'};
export function checkoutEmailHtml(subject,body){
 let html=signingEmailHtml(subject,body);
 for(const [key,url] of Object.entries(REVIEW_LINKS))html=html.replace(url,`<a href="${url}" style="display:inline-block;padding:12px 18px;background:#173d32;color:white;text-decoration:none;border-radius:8px;font-weight:bold">${{google:'Review on Google Maps',facebook:'Review on Facebook',website:'Review on our website'}[key]}</a>`);
 return html;
}
