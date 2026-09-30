import test from 'node:test';import assert from 'node:assert/strict';
import {validCartEvidence,matchesEvidence} from '../src/cart-check.mjs';
import {mergeStaffHistory} from '../src/staff-history.mjs';
import {readMetaHistory} from '../src/meta-history.mjs';
import {staffTotalCheck} from '../src/staff-order.mjs';
const customer='dobar dan,jel mogu da porucim ove od 1800 4 komada';
const seller='ELEGANCE SEAT (110086), loyalty 1.799 din.';
const items=[{sku:'110086',qty:4}];
test('buyer choice plus seller identification is valid evidence, never seller-only or fabricated text',()=>{
 const evidence={sku:'110086',qty:4,conversationQuotes:[customer,seller]};
 const valid=e=>validCartEvidence({matches:true,evidence:[e]},items,[customer],[customer,seller]);
 assert(valid(evidence));assert(!valid({...evidence,conversationQuotes:[seller]}));
 assert(!valid({...evidence,conversationQuotes:[customer,'Invented product']}));
 assert(!valid({...evidence,qty:5}));assert(!valid({...evidence,sku:'WRONG'}));
 assert(!validCartEvidence({matches:false,evidence:[evidence]},items,[customer],[customer,seller]));
 assert(valid({...evidence,conversationQuotes:[`„${customer}“`,`“${seller}”`]}));
 assert(matchesEvidence('„Test Kupac\\nTest ulica 1“',['Test Kupac\nTest ulica 1']));
 assert(!matchesEvidence('„Ipak 4 komada“',['Ipak 2 komada']));
});
test('staff import deduplicates echoes across sources and retains genuine repeats and old agreement',()=>{
 const remote=[{role:'user',content:customer,timestamp:1000},{role:'assistant',content:seller,timestamp:2000},{role:'assistant',content:seller,timestamp:3000},{role:'assistant',content:'Auto-label added: Lead stage set to intake.',timestamp:4000}];
 const local=[{role:'assistant',content:seller,timestamp:2100},{role:'assistant',content:'Cena je 7.196',timestamp:5000}];
 const saved=[...local,{role:'user',content:'Earlier address',timestamp:500}];
 const result=mergeStaffHistory({saved,remote,local,before:6000});
 assert.equal(result.filter(m=>m.content===seller).length,2);assert.equal(result.filter(m=>m.content==='Cena je 7.196').length,1);assert.equal(result[0].content,'Earlier address');assert(!result.some(m=>m.content.startsWith('Auto-label')));
});
test('long staff imports flag incomplete coverage rather than silently certifying truncated history',async()=>{
 let coverage;const messages=Array.from({length:100},(_,i)=>({from:{id:'buyer'},to:{data:[{id:'page'}]},created_time:new Date(i*1000).toISOString(),message:'Earlier message'}));
 const history=await readMetaHistory({account:{channel:'facebook',id:'page',token:'test'},sender:'buyer',before:200000,graphVersion:'v26.0',maxMessages:100,onCoverage:c=>coverage=c,fetchFn:async()=>({ok:true,json:async()=>({data:[{messages:{data:messages,paging:{next:'https://graph.facebook.com/next'}}}]})})});
 assert.equal(history.length,100);assert.equal(coverage.complete,false);
});
test('only the verified ERP first-purchase reduction may lower the staff-agreed total',()=>{
 const plan={input:{lines:[{sku:'110086',qty:4}]},unitPrices:[{sku:'110086',price:1799}],agreedTotal:7196};
 const quote={loyaltyApplied:true,totals:{subtotal:7196,total:6117,firstPurchaseDiscount:1079}};
 assert(staffTotalCheck(plan,quote).ok);assert.match(staffTotalCheck(plan,quote).notice,/1079/);
 assert(!staffTotalCheck(plan,{...quote,loyaltyApplied:false}).ok);
 for(const totals of [{...quote.totals,total:10280},{...quote.totals,total:6000},{...quote.totals,subtotal:7000},{...quote.totals,firstPurchaseDiscount:0}])assert(!staffTotalCheck(plan,{...quote,totals}).ok);
 assert(!staffTotalCheck({...plan,unitPrices:[]},quote).ok);
});
