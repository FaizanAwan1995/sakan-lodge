import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';
export const SIGNING_CONSENT_VERSION = 'sakan-sign-v1';
export const normalName = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function validateSignatures(signatures, names) {
  if (!Array.isArray(names) || !names.length || names.length > 20 || !Array.isArray(signatures) || signatures.length !== names.length) throw Error('Every resident named in the agreement must sign.');
  return names.map((name, i) => {
    const s=signatures[i];
    if (!s || typeof s.name !== 'string' || s.name.length > 160 || normalName(s.name) !== normalName(name) || s.consent !== true || !['typed','drawn'].includes(s.mode)) throw Error('Each resident must enter their own full name and agree to sign electronically.');
    let strokes=[];
    if(s.mode==='drawn') {
      if(!Array.isArray(s.strokes)||!s.strokes.length||s.strokes.length>50)throw Error('Draw a signature or choose a typed signature.');
      let points=0;
      strokes=s.strokes.map(stroke=>{
        if(!Array.isArray(stroke)||stroke.length<2||(points+=stroke.length)>1500)throw Error('Signature is too complex. Clear it and try again.');
        return stroke.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))throw Error('Invalid signature drawing.');return p.map(n=>Math.round(n*10000)/10000);});
      });
    }
    return {name:s.name.trim().replace(/\s+/g,' '),mode:s.mode,consent:true,strokes};
  });
}
const pdfText = value => String(value ?? '').normalize('NFKC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e\n]/g,'?');
// Append evidence to the exact original PDF. Never regenerate or replace its agreed terms.
export async function signedAgreementPdf(original, snapshot) {
  const {request:s,contract:c,code}=snapshot;
  const pdf=await PDFDocument.load(original,{updateMetadata:false});
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),typed=await pdf.embedFont(StandardFonts.TimesRomanItalic);
  pdf.setModificationDate(new Date(s.submitted_at));
  for(let i=0;i<s.signatures.length;i++) {
    const signer=s.signatures[i],page=pdf.addPage([595.28,841.89]);
    const text=(value,y,{size=11,font=regular}={})=>page.drawText(pdfText(value),{x:45,y,size,font,maxWidth:505,lineHeight:size*1.5,color:rgb(.08,.22,.17)});
    text('SAKAN Lodge - electronic signature receipt',785,{size:17,font:bold});
    text(`Reservation ${code} | Agreement v${c.version}`,748);
    text(`Signing reference: ${s.id}`,723,{size:9});
    const signerLabel=`Resident ${i+1} of ${s.signatures.length}: ${signer.name}`;
    text(signerLabel,675,{size:Math.min(14,500/bold.widthOfTextAtSize(pdfText(signerLabel),1)),font:bold});
    text(`Signed: ${new Date(s.submitted_at).toISOString()} (UTC)`,646);
    text('I have read the agreement, agree to its terms and consent to signing',605);
    text('electronically. This signature is my own.',585);
    if(signer.mode==='typed')text(signer.name,500,{size:Math.min(26,490/typed.widthOfTextAtSize(pdfText(signer.name),1)),font:typed});
    else for(const stroke of signer.strokes)for(let j=1;j<stroke.length;j++)page.drawLine({start:{x:50+stroke[j-1][0]*490,y:430+(1-stroke[j-1][1])*125},end:{x:50+stroke[j][0]*490,y:430+(1-stroke[j][1])*125},thickness:1.6,color:rgb(.08,.22,.17)});
    text(`Signature method: ${signer.mode==='typed'?'Typed full name':'Drawn signature with typed full name'}`,400);
    text('Signing submits the agreement for administrator review.',365);
    text('Room allocation is confirmed separately by SAKAN Lodge.',345);
    text('Original agreement SHA-256:',280,{size:9,font:bold});
    text(s.document_hash,261,{size:8});
    text('Signature submission SHA-256:',229,{size:9,font:bold});
    text(s.submission_hash,210,{size:8});
    text(`Consent record: ${SIGNING_CONSENT_VERSION}`,175,{size:9});
    text('Access: private invitation link issued to the applicant email.',150,{size:9});
    text('The administrator reviews the signatures and applicant identity.',132,{size:9});
    text('Keep this copy with the original agreement pages preceding this receipt.',85,{size:9});
  }
  return pdf.save();
}
