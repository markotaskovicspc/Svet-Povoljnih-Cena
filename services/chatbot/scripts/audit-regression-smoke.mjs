// Synthetic conversations only. No production reads, writes or customer sends.
import assert from 'node:assert/strict';
import {answer} from '../src/agent.mjs';
const model=process.env.OPENAI_MODEL;
assert(model,'Use the existing configured model');
const product={sku:'110055',name:'Set za čišćenje POWER MOP',price:699,available:true,checkedQuantity:1};
const shipping={firstName:'Test',lastName:'Kupac',phone:'0601234567',street:'Test ulica',houseNumber:'bb',city:'Bajevac, Lajkovac',postalCode:null};
const input={guestEmail:null,shipping,lines:[{sku:product.sku,qty:1}],paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR'};
const offer={input,totals:{total:998,shipping:299},quoteToken:'synthetic',productNames:{[product.sku]:product.name}};
const scenarios=[
 {name:'equipment question does not regenerate quote',state:{history:[{role:'user',content:'Jedan POWER MOP.'},{role:'assistant',content:'Set za čišćenje POWER MOP (110055) × 1. Ukupno 998 din. Za potvrdu odgovorite DA.'}],orders:[],pending:offer},text:'Da li kanta ide uz set?',check:(r,calls)=>{assert(calls.includes('product_details'));assert(!calls.includes('quote'));assert(/kanta/i.test(r.text));assert(!/Za potvrdu/.test(r.text));assert(!r.quoteCreated);}},
 {name:'known locality is not asked repeatedly and delivery question is answered',state:{history:[{role:'user',content:'Jedan POWER MOP. Test Kupac, Test ulica bb, Bajevac, Lajkovac, 0601234567.'},{role:'assistant',content:'Koje naselje i opština?'},{role:'user',content:'Bajevac, opština Lajkovac.'},{role:'assistant',content:'Koje naselje i opština za dostavu?'}],orders:[],customer:{shipping},addressIssue:{key:JSON.stringify([shipping.city,null])}},text:'Isto mesto sam već napisao. Koliko traje dostava?',check:r=>{assert(/2\s*(?:–|-|do)\s*3/.test(r.text),r.text);assert(!/koje.*(?:naselje|opštin)/i.test(r.text));}},
 {name:'image clarification retains quality question without internal descriptions',state:{history:[],orders:[],visualContext:{createdAt:Date.now(),images:[{imageNumber:1,objects:[{position:'gore levo',description:'crna stolica mrežastog naslona sa rukonaslonima',visibleName:'',visibleSku:''},{position:'dole desno',description:'bela stolica plastičnog naslona',visibleName:'',visibleSku:''}]}]}},text:'Kakvog su kvaliteta ove stolice, imaju li garanciju?',check:r=>{assert(!/mrežastog naslona sa rukonaslonima/.test(r.text));assert(!/;/.test(r.text));assert(/garanc|kvalitet|model|stolic/i.test(r.text));assert(r.text.length<650);}},
];
for(const scenario of scenarios){
 const calls=[];const spc=async p=>{calls.push(p.action);if(p.action==='search')return {ok:true,items:[product]};if(p.action==='product_details')return {ok:true,product:{...product,description:'Set sadrži kantu i mop sa dve krpe.',technicalSpecs:[]}};if(p.action==='quote')return {ok:false,error:{code:'DELIVERY_ADDRESS_INVALID'}};throw Error('Unexpected action: '+p.action);};
 const r=await answer({model,spc,state:structuredClone(scenario.state),event:{channel:'facebook',conversation:'synthetic-audit-regression',text:scenario.text,attachments:[]}});
 scenario.check(r,calls);console.log(JSON.stringify({scenario:scenario.name,passed:true,reply:r.text}));
}
{
 const at=Date.now(),products=[{sku:'110001',name:'Seckalica CHOP GENIE',price:1999,available:true,checkedQuantity:1},{sku:'110002',name:'Fen TURBO AIR',price:1499,available:true,checkedQuantity:1}];
 const state={orders:[],history:[{role:'user',content:'Jednu seckalicu CHOP GENIE i jedan fen TURBO AIR.'},{role:'assistant',content:'Seckalica CHOP GENIE (110001) i Fen TURBO AIR (110002), po jedan. Da li su to ti proizvodi?',timestamp:at-2000},{role:'user',content:'Da',timestamp:at-1000}],visualContext:{createdAt:at,images:[{imageNumber:1,objects:[{position:'sredina',description:'fen',visibleName:'TURBO AIR',visibleSku:'110002'}]}]}};
 const calls=[],spc=async p=>{calls.push(p.action);if(p.action==='search')return {ok:true,items:products.filter(item=>p.query===item.sku||item.name.toLowerCase().includes(p.query.toLowerCase()))};if(p.action==='quote')return {ok:true,input:p.input,quoteToken:'synthetic',totals:{total:3797,shipping:299}};throw Error('Unexpected action: '+p.action);};
 const r=await answer({state,model,spc,event:{channel:'facebook',conversation:'synthetic-photo-checkout',text:'Test Kupac, Test ulica 1, Bajevac, Lajkovac, 0601234567',attachments:[]}});
 assert(r.quoteCreated,r.text);assert(calls.includes('quote'));assert.equal(state.pending.input.guestEmail,null);assert.deepEqual(state.pending.input.lines.map(l=>l.sku).sort(),['110001','110002']);
 console.log(JSON.stringify({scenario:'later photo preserves accepted two-product basket and checkout without email',passed:true}));
}
