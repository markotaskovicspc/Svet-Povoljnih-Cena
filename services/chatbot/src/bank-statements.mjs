import {createHash} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {signRequest} from './security.mjs';
import {dkimVerify} from 'mailauth/lib/dkim/verify.js';

const ACCOUNT='340000100028300451';
// Customers type the order number loosely: lower case, spaces, dots, slashes, missing
// dashes or missing leading zeros. All of them map to the canonical SPC-YYYY-NNNNNN.
// A wrong number still cannot confirm anything: ERP requires the exact order total.
const SPC_NUMBER=/(?<![A-Z0-9])SPC[\s\-_/.]*(20\d{2})[\s\-_/.]*(\d{1,6})(?!\d)/gi;
export const orderNumbers=text=>[...new Set([...String(text??'').normalize('NFKC').matchAll(SPC_NUMBER)].map(m=>`SPC-${m[1]}-${m[2].padStart(6,'0')}`))];
const mentionsSpc=text=>/(?<![A-Z0-9])SPC/i.test(String(text??'').normalize('NFKC'));
export function rsdMinor(value){
  if(!/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(value))throw Error('BANK_AMOUNT_INVALID');
  const minor=Number(value.replaceAll('.','').replace(',',''));
  if(!Number.isSafeInteger(minor))throw Error('BANK_AMOUNT_INVALID');
  return minor;
}
// Text positions matter: an outgoing payment with SPC in its purpose is not a credit.
export async function parseErsteStatement(buffer){
  if(buffer.length>5*1024*1024||buffer.subarray(0,5).toString()!=='%PDF-')throw Error('BANK_PDF_INVALID');
  const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true});
  const document=await task.promise;
  try{
    if(document.numPages>30)throw Error('BANK_PDF_TOO_LONG');
    const pages=[];
    for(let n=1;n<=document.numPages;n++){
      const page=await document.getPage(n),viewport=page.getViewport({scale:1});
      const content=await page.getTextContent();
      pages.push(content.items.filter(x=>typeof x.str==='string'&&x.str.trim()).map(x=>{const [left,top]=viewport.convertToViewportPoint(x.transform[4],x.transform[5]);return {text:x.str.trim(),x:left/viewport.width,y:-top};}));
    }
    const header=pages[0].map(x=>x.text).join(' ');
    if(!header.includes('Erste Bank')||!header.includes('115085587')||!header.includes(ACCOUNT)||!header.includes('941 RSD'))throw Error('BANK_STATEMENT_WRONG_ACCOUNT');
    const match=header.match(/Izvod broj i datum:\s*(\d+)\s*\/\s*(\d{2})\.(\d{2})\.(\d{4})/);
    if(!match)throw Error('BANK_STATEMENT_HEADER_INVALID');
    const statement=match[1],date=`${match[4]}-${match[3]}-${match[2]}`;
    const summary=header.match(/Ukupno u korist\s*([\d.,]+)\s*RSD/);
    if(!summary)throw Error('BANK_STATEMENT_TOTAL_MISSING');
    const expectedCredit=rsdMinor(summary[1]);let totalCredit=0;const entries=[],unmatched=[];
    for(const items of pages){
      const anchors=items.filter(x=>x.x<0.08&&/^\d+$/.test(x.text)&&items.some(d=>d.x>0.08&&d.x<0.17&&Math.abs(d.y-x.y)<3&&/^\d{2}\.\d{2}\.\d{4}\.$/.test(d.text))).sort((a,b)=>b.y-a.y);
      const nearest=item=>anchors.reduce((best,a)=>!best||Math.abs(a.y-item.y)<Math.abs(best.y-item.y)?a:best,null);
      for(const anchor of anchors){
        const row=items.filter(x=>nearest(x)===anchor);
        const amounts=row.filter(x=>x.x>0.88&&Math.abs(x.y-anchor.y)<3&&/^[\d.]+,\d{2}$/.test(x.text));
        if(amounts.length>1)throw Error('BANK_CREDIT_AMBIGUOUS');
        if(!amounts.length)continue;
        const amountMinor=rsdMinor(amounts[0].text);totalCredit+=amountMinor;
        const referenceItems=row.filter(x=>x.x>0.63&&x.x<0.78);
        if(referenceItems.some(x=>(/(?<![A-Z0-9])SPC[\s\-_/.]*\d/i.test(x.text)||/\bFT[A-Z0-9]/.test(x.text))&&Math.abs(x.y-anchor.y)>30))throw Error('BANK_REFERENCE_AMBIGUOUS');
        const refs=referenceItems.sort((a,b)=>b.y-a.y||a.x-b.x).map(x=>x.text).join(' ');
        const orders=orderNumbers(refs);
        const bankRefs=[...refs.matchAll(/\bFT[A-Z0-9]{8,30}\b/g)].map(x=>x[0]);
        if(!orders.length){
          // No readable order number in PBO/PBZ: never applied automatically. Support gets a
          // review (with same-amount order suggestions from ERP). Only the order number seen
          // elsewhere in the row is forwarded, never the payer name or purpose text.
          if(bankRefs.length===1){
            const rowText=row.map(x=>x.text).join(' '),elsewhere=orderNumbers(rowText);
            unmatched.push({account:ACCOUNT,statement,date,bankReference:bankRefs[0],amountMinor,currency:'RSD',
              reason:elsewhere.length===1?'SPC_NOT_IN_REFERENCE':mentionsSpc(rowText)?'SPC_UNREADABLE':'SPC_MISSING',
              ...(elsewhere.length===1?{suggestedOrderNumber:elsewhere[0]}:{})});
          }
          continue;
        }
        const pbo=refs.match(/\bPBO:\s*(.*?)(?=\bPBZ:|\bFT[A-Z0-9]|$)/)?.[1]??'';
        const pboOrders=orderNumbers(pbo);
        // Repeated PBO/PBZ values are one order; conflicting values still reject the PDF.
        if(orders.length!==1||pboOrders.length!==1||pboOrders[0]!==orders[0]||bankRefs.length!==1)throw Error('BANK_REFERENCE_AMBIGUOUS');
        entries.push({account:ACCOUNT,statement,date,bankReference:bankRefs[0],orderNumber:orders[0],amountMinor,currency:'RSD'});
      }
    }
    if(totalCredit!==expectedCredit)throw Error('BANK_CREDIT_TOTAL_MISMATCH');
    const references=[...entries,...unmatched].map(x=>x.bankReference);
    if(new Set(references).size!==references.length)throw Error('BANK_DUPLICATE_REFERENCE');
    return {sourceHash:createHash('sha256').update(buffer).digest('hex'),account:ACCOUNT,statement,date,entries,unmatched};
  }finally{await task.destroy();}
}

export function isBankMail(mail,env){
  const allowed=(env.BANK_STATEMENT_SENDERS??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const senders=mail.from?.value??[];
  return senders.length===1&&allowed.includes(senders[0].address.toLowerCase());
}
export async function verifyBankMail(source,mail,env,verify=dkimVerify){
  if(!isBankMail(mail,env))return false;
  const domain=mail.from.value[0].address.toLowerCase().split('@')[1];
  const result=await verify(source,{rejectRsaSha1:true});
  if(result.results.some(r=>r.status?.result==='temperror'))throw Error('BANK_VERIFICATION_UNAVAILABLE');
  // Verify the actual signature, never trust a customer-supplied Authentication-Results header.
  return result.results.some(r=>r.status?.result==='pass'&&r.signingDomain?.toLowerCase()===domain&&!r.canonBodyLengthLimited&&!r.status.testing);
}
export async function submitBankStatement(statement,env,{dryRun=false}={}){
  const url=new URL('/api/integrations/bank-statements',env.SPC_BASE_URL);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('BANK_HTTPS_REQUIRED');
  const body=JSON.stringify({...statement,dryRun});
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...signRequest(body,env.SOCIAL_INTEGRATION_SECRET)},body,signal:AbortSignal.timeout(25000),redirect:'error'});
  if(response.status===409&&!statement.rejectedReason)return submitBankStatement({sourceHash:statement.sourceHash,rejectedReason:'BANK_REFERENCE_CONFLICT'},env);
  if(!response.ok)throw Error(`BANK_API_${response.status}`);
  return response.json();
}
