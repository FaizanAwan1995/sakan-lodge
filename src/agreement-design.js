export const DEFAULT_AGREEMENT_DESIGN = Object.freeze({title:'ROOMING HOUSE AGREEMENT',theme:'navy',fontSize:10,showLogo:true});
export const AGREEMENT_THEMES = Object.freeze({navy:['#1f3347','#8f662e'],forest:['#193c32','#ad8140'],plum:['#51354a','#ad8140']});
export function agreementDesign(value={}) {
  const title=String(value?.title ?? DEFAULT_AGREEMENT_DESIGN.title).trim();
  if(!title || title.length>32 || /[^\x20-\x7e]/.test(title))throw Error('Agreement title must be 1–32 plain English characters.');
  if(!Object.hasOwn(AGREEMENT_THEMES,value?.theme ?? 'navy'))throw Error('Choose an agreement colour theme.');
  const fontSize=Number(value?.fontSize ?? 10);
  if(![10,11,12].includes(fontSize))throw Error('Choose a body text size from 10 to 12.');
  if(value?.showLogo!==undefined && typeof value.showLogo!=='boolean')throw Error('Logo setting must be true or false.');
  return {title,theme:value?.theme ?? 'navy',fontSize,showLogo:value?.showLogo ?? true};
}
