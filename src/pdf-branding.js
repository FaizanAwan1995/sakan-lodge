import {pushGraphicsState,popGraphicsState,moveTo,appendBezierCurve,closePath,clip,endPath} from 'pdf-lib';
import {contractLogoJpeg} from './contract-logo.js';
export const embedContractLogo=pdf=>pdf.embedJpg(Uint8Array.from(atob(contractLogoJpeg),c=>c.charCodeAt(0)));
// Native PDF clipping removes only the white surround; the owner artwork is unchanged.
export function drawContractLogo(page,logo,{x,y,width}){
 const height=width*logo.height/logo.width,cx=x+width*624/1254,cy=y+height*649/1254,rx=width*618/1254,ry=height*598/1254,k=.5522847498;
 page.pushOperators(pushGraphicsState(),moveTo(cx+rx,cy),appendBezierCurve(cx+rx,cy+k*ry,cx+k*rx,cy+ry,cx,cy+ry),appendBezierCurve(cx-k*rx,cy+ry,cx-rx,cy+k*ry,cx-rx,cy),appendBezierCurve(cx-rx,cy-k*ry,cx-k*rx,cy-ry,cx,cy-ry),appendBezierCurve(cx+k*rx,cy-ry,cx+rx,cy-k*ry,cx+rx,cy),closePath(),clip(),endPath());
 page.drawImage(logo,{x,y,width,height});page.pushOperators(popGraphicsState());
}
