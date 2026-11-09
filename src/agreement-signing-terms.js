// Refresh workflow instructions for newly reviewed templates; never rewrite historical signed records.
export const onlineSigningTerms = terms => String(terms || '').replaceAll(
  'reply to sakanlodges@gmail.com with the signed agreement and payment receipt.',
  'sign the agreement using your private SAKAN online signing link. Do not email the signed agreement back. Contact sakanlodges@gmail.com about any payment receipt.',
);
