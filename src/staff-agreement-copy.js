import {supabase} from './store.js';
import {countersignedAgreementPdf, isApplicationPdf} from './contract-signing.js';

// Staff downloads use the same immutable resident PDF and recorded approval as the private link.
export async function staffAgreementCopy(contract, path, code) {
  const {data:blob,error} = await supabase.storage.from('reservation-contracts').download(path);
  if (error) throw error;
  if (!isApplicationPdf(contract) || path !== contract.signed_document_path) return blob;
  const review = await supabase.from('contract_signing_requests')
    .select('id,status,reviewed_at,reviewed_by,signed_document_hash')
    .eq('contract_id',contract.id).eq('signed_document_path',path).maybeSingle();
  if (review.error) throw review.error;
  if (review.data?.status !== 'approved') return blob;
  const details = await supabase.from('contracts').select('version,fields').eq('id',contract.id).single();
  if (details.error) throw details.error;
  const bytes = await countersignedAgreementPdf(await blob.arrayBuffer(),{code,contract:details.data,request:review.data});
  return new Blob([bytes],{type:'application/pdf'});
}
