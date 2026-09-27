import type {Product} from '@/types';

// Public product-page fields only; never serialize the entire catalog/DB record.
export function productText(value:string|undefined,limit=12000){
 const text=(value??'').replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
  .replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,e=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[e]??e)
  .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';})
  .replace(/\s+/g,' ').trim();
 return {text:text.slice(0,limit),truncated:text.length>limit};
}
const dimensions=(d:Product['dimensionsCm']|undefined)=>{
 const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
 const result={width:positive(d?.w),depth:positive(d?.d),height:positive(d?.h),unit:'cm' as const};
 return result.width||result.depth||result.height?result:null;
};
export function socialProductDetails(p:Product){
 const description=productText(p.description);
 return {sku:p.sku,name:p.name,url:`https://www.svetpovoljnihcena.rs/p/${encodeURIComponent(p.slug)}`,
  description:description.text,descriptionTruncated:description.truncated,shortDescription:productText(p.shortDescription,2000).text,
  dimensions:dimensions(p.dimensionsCm),packageDimensions:dimensions(p.unitPackageDimensionsCm),
  colorPrimary:p.colorPrimary??null,colorSecondary:p.colorSecondary??null,sizeLabel:p.sizeLabel??null,
  attributes:(p.attributes??[]).slice(0,20).map(x=>productText(x,300).text),materials:p.materials.map(m=>productText(m.label,200).text),
  technicalSpecs:(p.technicalSpecs??[]).slice(0,80).map(s=>({label:productText(s.label,150).text,value:productText(s.value,600).text})),
  warrantyYears:p.warrantyYears??null,countryOfOrigin:p.countryOfOrigin??null,
  maintenance:productText(p.pdpInfo?.maintenance,2000).text,assemblyInstructions:productText(p.pdpInfo?.assemblyInstructions,2000).text,
 };
}
