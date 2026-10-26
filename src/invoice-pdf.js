import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { contractLogoJpeg } from './contract-logo.js';
const clean=v=>String(v??'').normalize('NFKC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\x00-\x1f]/g,' ');
const dollars=n=>'AUD $'+Number(n).toFixed(2);
const date=s=>new Date(s+'T00:00:00Z').toLocaleDateString('en-AU',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
export async function rentInvoicePdf(invoice){
 const s=invoice.snapshot;
 if(!s?.tenant_name||!s.address||!s.payment||!Array.isArray(s.lines)||!s.lines.length)throw Error('Complete invoice details before generating PDF');
 if(Math.abs(s.lines.reduce((n,l)=>n+Number(l.amount),0)-Number(s.payment.amount))>0.005)throw Error('Invoice allocation does not match receipt');
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),italic=await pdf.embedFont(StandardFonts.HelveticaOblique);
 pdf.setTitle('SAKAN Lodge paid invoice #'+invoice.number);pdf.setAuthor('SAKAN Lodge');
 const logo=await pdf.embedJpg(Uint8Array.from(atob(contractLogoJpeg),c=>c.charCodeAt(0)));
 const green=rgb(.09,.24,.20),grey=rgb(.35,.39,.37),gold=rgb(.80,.64,.35);
 let page,y;
 const text=(v,x,yy,size=10,f=font,color=grey)=>page.drawText(clean(v),{x,y:yy,size,font:f,color});
 const right=(v,x,yy,size=10,f=font,color=grey)=>text(v,x-f.widthOfTextAtSize(clean(v),size),yy,size,f,color);
 const wrap=(v,x,yy,width,size=10,f=font)=>{let line='',out=[];for(const word of clean(v).split(/\s+/)){if(f.widthOfTextAtSize(line+' '+word,size)>width&&line){out.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)out.push(line);out.forEach((line,i)=>text(line,x,yy-i*14,size,f));return yy-out.length*14;};
 function start(){page=pdf.addPage([595.28,841.89]);page.drawImage(logo,{x:110,y:260,width:375,height:375,opacity:.045});text('SAKAN Lodge',42,780,22,bold,green);wrap(s.address,42,758,245,10);right('INVOICE',553,780,27,bold,green);right('PAID',553,754,13,bold,green);right('#'+invoice.number,553,731,12,bold);right('Issued '+date(s.issued_date),553,712,10);page.drawLine({start:{x:42,y:690},end:{x:553,y:690},thickness:2,color:gold});text('BILL TO',42,662,10,bold,green);const nameBottom=wrap(s.tenant_name,42,642,280,12,bold);const propertyBottom=wrap([s.property,s.room].filter(Boolean).join(' - '),42,nameBottom-6,280,10);right('PAYMENT METHOD',553,662,10,bold,green);right(s.payment.method==='cash'?'Cash':'Bank transfer',553,642,11);right('Received '+date(s.payment.date),553,622,10);y=Math.min(583,propertyBottom-30);if(invoice.replaces_number){text('Replaces invoice #'+invoice.replaces_number,42,y,10,bold);y-=24;}text('NO',42,y,9,bold,green);text('ITEM / RENT PERIOD',75,y,9,bold,green);right('WEEKLY RENT',409,y,9,bold,green);right('QTY',469,y,9,bold,green);right('AMOUNT PAID',553,y,9,bold,green);y-=16;page.drawLine({start:{x:42,y},end:{x:553,y},thickness:.6,color:grey});y-=24;}
 start();
 s.lines.forEach((line,i)=>{if(y<220)start();text(String(i+1),45,y,10);let bottom=wrap(line.description,75,y,245,10,bold);if(line.period_start){text(date(line.period_start)+' - '+date(line.period_end),75,bottom,9);bottom-=16;}if(line.charge_amount&&Number(line.amount)<Number(line.charge_amount)){text('Part payment toward '+dollars(line.charge_amount),75,bottom,9);bottom-=16;}right(line.weekly_rate!=null?'$'+Number(line.weekly_rate).toFixed(2):'-',409,y,10);right(line.period_start?Math.round((Date.parse(line.period_end)-Date.parse(line.period_start))/86400000+1)+' days':'-',469,y,9);right('$'+Number(line.amount).toFixed(2),553,y,11,bold);y=Math.min(y-48,bottom-20);});
 if(y<215)start();page.drawLine({start:{x:315,y},end:{x:553,y},thickness:1,color:green});right('Payment received',443,y-24,11,bold);right(dollars(s.payment.amount),553,y-24,11,bold,green);text('This confirms the recorded payment only.',42,y-62,10);text('Partial payments may leave a rent balance outstanding.',42,y-78,10);text('TERMS AND CONDITIONS',42,105,10,bold,green);text('As per the SAKAN Lodge accommodation agreement.',42,88,9,italic);text('Issued electronically by SAKAN Lodge',42,69,9);right('sakanlodges@gmail.com',553,88,9);
 const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`${i+1} / ${pages.length}`,{x:525,y:35,size:8,font,color:grey}));return pdf.save();
}
