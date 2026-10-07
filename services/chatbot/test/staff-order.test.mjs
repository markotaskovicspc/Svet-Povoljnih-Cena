import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents} from '../src/security.mjs';
import {isStaffOrderCommand,prepareStaffOrder,executeStaffOrder,searchStaffProducts,hasCitedAmount} from '../src/staff-order.mjs';
import {validCartEvidence} from '../src/cart-check.mjs';
import {productOffer} from '../src/product-media.mjs';
const input={guestEmail:'buyer@example.com',shipping:{firstName:'Petar',lastName:'Petrović',phone:'0601234567',street:'Test',houseNumber:'12',city:'Kragujevac',postalCode:'34000'},lines:[{sku:'IRON',qty:1}],paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR'};
const event={id:'command-1',channel:'facebook',conversation:'page:buyer',echo:true,text:'/porudzbina',timestamp:Date.now()};
const state=()=>({history:[{role:'user',content:'Želim jednu peglu IRON. Petar Petrović, 0601234567, Test 12, Kragujevac 34000, buyer@example.com, pouzećem.',timestamp:Date.now()-1000}],orders:[]});
test('staff command checks the complete buyer agreement despite a later attachment',async()=>{
 const context=state();context.visualContext={createdAt:Date.now(),images:[]};context.history.push({role:'user',content:'[Prilog kupca]',timestamp:Date.now()});
 const r=await prepareStaffOrder({event,state:context,model:'test',extractFn:async()=>({input,reason:'',agreedTotal:null,priceEvidence:null,unitPrices:[],deliveryNotes:[]}),cartCheckFn:async args=>{
  assert.equal(args.requireVisualPresentation,false);
  assert.equal(args.state.history.length,2);
  assert.match(args.state.history[0].content,/Želim jednu peglu/);
  return {ok:true};
 },spc:async p=>p.action==='search'?{ok:true,items:[{sku:'IRON',name:'Pegla',price:1000,available:true}]}:{ok:true,totals:{total:1400}}});
 assert.equal(r.ok,true);
});
test('full slash address and separate literal delivery notes survive without customer email',async()=>{
 const shipping={...input.shipping,city:'Kruševac',houseNumber:'40/63'};
 const context={orders:[],history:[{role:'user',content:'Želim jednu peglu IRON. Петар Петровић, 0601234567, Тест 40/63, Крушевац 34000.'},{role:'assistant',content:'Možemo da potvrdimo termin isporuke u utorak'},{role:'user',content:'Onda može. Ulaz C.'}]};
 const notes=['Možemo da potvrdimo termin isporuke u utorak','Ulaz C'];
 let writes=0;
 const prepare=deliveryNotes=>prepareStaffOrder({event,state:context,model:'test',extractFn:async()=>({input:{...input,guestEmail:null,shipping},reason:'',agreedTotal:null,priceEvidence:null,unitPrices:[],deliveryNotes}),cartCheckFn:async()=>({ok:true}),spc:async p=>{
  if(p.action==='search')return {ok:true,items:[{sku:'IRON',name:'Pegla',price:1000,available:true}]};
  assert.equal(p.action,'quote');assert.equal(p.input.shipping.houseNumber,'40/63');assert.equal(p.input.guestEmail,null);assert.equal(p.input.notes,notes.join('; '));writes++;return {ok:true,totals:{total:1400}};
 }});
 assert((await prepare(notes)).ok);assert.equal(writes,1);
 const bad=await prepare(['Ulaz D']);assert.equal(bad.code,'STAFF_DELIVERY_NOTES_EVIDENCE_INVALID');assert.equal(writes,1);
});
test('empty full-name lookup falls back to model name; multiple genuine confirmations support one cart line',async()=>{
 const calls=[];const found=await searchStaffProducts(async p=>{calls.push(p.query);return {ok:true,items:p.query==='ELEGANCE SEAT'?[{sku:'CHAIR'}]:[]};},'ELEGANCE SEAT crna');
 assert.deepEqual(calls,['ELEGANCE SEAT crna','ELEGANCE SEAT']);assert.equal(found.items[0].sku,'CHAIR');
 const items=[{sku:'CHAIR',qty:14}],messages=['14 komada','14 komada crne'];
 const checked={matches:true,evidence:messages.map(customerQuote=>({sku:'CHAIR',qty:14,customerQuote}))};
 assert(validCartEvidence(checked,items,messages));
 assert(validCartEvidence({...checked,evidence:[{sku:'CHAIR',qty:14,customerQuote:'"14 komada" / "14 komada crne"'}]},items,messages));
 assert(!validCartEvidence({...checked,evidence:[...checked.evidence,{sku:'OTHER',qty:1,customerQuote:'14 komada'}]},items,messages));
 assert(!validCartEvidence(checked,items,['14 komada']));
});
test('price citations allow quotation marks but never a fabricated or omitted price',async()=>{
 const context=state();context.history.push({role:'assistant',content:'Cena je 1.000 din.'});
 assert(hasCitedAmount('"Cena je 1.000 din."',1000,context.history));
 assert(!hasCitedAmount('"Cena je 1.000 din."',1200,context.history));
 assert(!hasCitedAmount('"Cena je 1.200 din."',1200,context.history));
 for(const unitPrices of [[],[{sku:'IRON',price:1200,evidence:'Cena je 1.000 din.'}]]){
  const r=await prepareStaffOrder({event,state:context,model:'test',spc:()=>{throw Error('must stop before quote');},extractFn:async()=>({input,reason:'',agreedTotal:null,priceEvidence:null,unitPrices}),cartCheckFn:async()=>({ok:true})});assert(!r.ok);
 }
});
test('staff loyalty price reuses a recorded membership without accepting new consent',async()=>{
 const context=state();context.history.push({role:'assistant',content:'Cena je 700 din.'});let active=true,quoteCalls=0;
 const plan={input,reason:'',agreedTotal:null,priceEvidence:null,unitPrices:[{sku:'IRON',price:700,evidence:'Cena je 700 din.'}]};
 const spc=async p=>{if(p.action==='search')return {ok:true,items:[{sku:'IRON',name:'Pegla',price:1000,loyaltyPrice:700,available:true}]};if(p.action==='existing_loyalty')return {ok:true,active,email:input.guestEmail,proof:active?'existing-proof':undefined,expiresAt:Date.now()+60000};if(p.action==='quote'){quoteCalls++;assert.equal(p.loyaltyProof,'existing-proof');return {ok:true,totals:{total:700}};}if(p.action==='staff_quote'){quoteCalls++;assert.deepEqual(p.staffPricing.prices,[{sku:'IRON',price:700}]);return {ok:true,staffPricingApplied:true,totals:{total:700}};}throw Error('No enrollment/write');};
 const prepare=()=>prepareStaffOrder({event,state:context,spc,model:'test',extractFn:async()=>plan,cartCheckFn:async()=>({ok:true})});
 assert((await prepare()).ok);assert.equal(quoteCalls,1);delete context.loyalty;active=false;
 assert((await prepare()).ok);assert.equal(quoteCalls,2);assert.equal(context.loyalty,undefined);
});
test('Page command includes Business Suite app echoes; customer, bot and spoofed echoes are not privileged',()=>{
 const envelope=message=>({object:'page',entry:[{id:'page',messaging:[{sender:{id:'page'},recipient:{id:'buyer'},timestamp:Date.now(),message:{mid:'test',is_echo:true,text:'/porudzbina',...message}}]}]});
 const parse=body=>parseEvents(body,[{id:'page',channel:'facebook'}]);
 assert(isStaffOrderCommand(parse(envelope({}))[0]));
 assert(isStaffOrderCommand(parse(envelope({app_id:'business-suite'}))[0]));
 for(const message of [{metadata:'spc-bot'},{text:'Kupac kaže /porudzbina'}])assert(!isStaffOrderCommand(parse(envelope(message))[0]));
 assert(!isStaffOrderCommand({...event,echo:false}));assert(!isStaffOrderCommand({...event,channel:'instagram'}));
 const bad=envelope({});bad.entry[0].messaging[0].sender.id='attacker';assert.equal(parse(bad).length,0);
});
test('complete staff agreement produces a quote; absent contact, mismatch or unavailable stock never does',async()=>{
 let available=true,quotes=0;const context=state();
 const spc=async p=>p.action==='search'?{ok:true,items:[{sku:'IRON',name:'Pegla',price:1000,available}]}:(quotes++,{ok:true,quoteToken:'signed',input:p.input,totals:{total:1400}});
 const plan={input,reason:'',agreedTotal:null,priceEvidence:null,unitPrices:[]};
 const prepare=extract=>prepareStaffOrder({event,state:context,spc,model:'test',extractFn:async()=>extract,cartCheckFn:async()=>({ok:true})});
 assert((await prepare(plan)).ok);assert.equal(quotes,1);
 assert(!(await prepare({...plan,input:{...input,guestEmail:'invented@example.com'}})).ok);
 assert(!(await prepare({...plan,unitPrices:[{sku:'IRON',price:999,evidence:'Želim jednu peglu IRON.'}]})).ok);
 available=false;assert(!(await prepare(plan)).ok);assert.equal(quotes,1);
});
test('staff write recovers same signed quote after timeout, never requests customer DA or duplicates',async()=>{
 const context=state(),tokens=[];let prepared=0,saved;
 const params={event,state:context,save:async()=>{saved=structuredClone(context);},prepare:async()=>{prepared++;return {ok:true,quote:{quoteToken:'stable'},customer:input,items:input.lines,fingerprint:'cart'};},spc:async p=>{tokens.push(p.quoteToken);if(tokens.length===1)throw Error('lost response');return {ok:true,data:{number:'TEST-1',accessToken:'private',total:1400}};}};
 await assert.rejects(()=>executeStaffOrder(params),/lost response/);assert.equal(saved.staffOrder.status,'creating');
 const restarted={...params,state:saved,save:async()=>{}};
 const message=await executeStaffOrder(restarted);assert.match(message,/uspešno kreirana/);assert(!message.includes('DA'));assert.deepEqual(tokens,['stable','stable']);assert.equal(prepared,1);
 assert.equal(await executeStaffOrder(restarted),message);assert.equal(tokens.length,2);assert.equal(saved.orders.length,1);
});
test('another command cannot bypass a pending write and repeated same cart without new buyer message cannot write',async()=>{
 const context=state();context.staffOrder={status:'creating',eventId:'older'};
 const base={event,state:context,spc:()=>{throw Error('must not write');},save:async()=>{},prepare:()=>{throw Error('must not prepare');}};
 assert.match(await executeStaffOrder(base),/Prethodna komanda/);
 delete context.staffOrder;context.orders=[{number:'OLD',staffFingerprint:'cart',createdAt:Date.now()}];
 assert.match(await executeStaffOrder({...base,prepare:async()=>({ok:true,fingerprint:'cart'})}),/već kreirana/);
});
test('loyalty offer uses exact ERP prices in Serbian format without markdown or a shipping promise',()=>{
 const offer=productOffer({price:2580,loyaltyPrice:1799});
 assert.match(offer,/2\.580 din/);assert.match(offer,/1\.799 din/);assert.match(offer,/Vaš pristanak/);assert(!offer.includes('**'));assert(!offer.includes('besplatna dostava'));
 assert(!productOffer({price:1000,loyaltyPrice:null}).includes('loyalty'));
});

test('seller command honors agreed loyalty prices without email, membership or fake consent',async()=>{
 const context=state();context.history.push({role:'assistant',content:'Cena je 700 din.'});
 const noEmail={...input,guestEmail:null};const calls=[];
 const plan={input:noEmail,reason:'',agreedTotal:null,priceEvidence:null,unitPrices:[{sku:'IRON',price:700,evidence:'Cena je 700 din.'}]};
 const spc=async p=>{calls.push(p);if(p.action==='search')return {ok:true,items:[{sku:'IRON',name:'Pegla',price:1000,loyaltyPrice:700,available:true}]};if(p.action==='staff_quote')return {ok:true,staffPricingApplied:true,quoteToken:'signed',totals:{total:999}};throw Error('Unexpected enrollment or write');};
 const params={event,state:context,spc,model:'test',extractFn:async()=>plan,cartCheckFn:async()=>({ok:true})};
 assert((await prepareStaffOrder(params)).ok);
 const quote=calls.find(p=>p.action==='staff_quote');assert.equal(quote.input.guestEmail,null);assert.equal(quote.input.guestLoyalty,undefined);assert.equal(quote.loyaltyProof,undefined);
 assert.deepEqual(quote.staffPricing,{commandId:event.id,prices:[{sku:'IRON',price:700}]});assert.equal(context.loyalty,undefined);
 calls.length=0;assert(!(await prepareStaffOrder({...params,event:{...event,echo:false}})).ok);assert.equal(calls.length,0);
 plan.unitPrices=[{sku:'IRON',price:600,evidence:'Cena je 600 din.'}];context.history.push({role:'assistant',content:'Cena je 600 din.'});
 assert(!(await prepareStaffOrder(params)).ok);assert(!calls.some(p=>p.action==='staff_quote'));
});

test('staff order preserves explicitly supplied Vracar even if model extracts only Beograd',async()=>{
 const context={history:[{role:'user',content:'Jedna pegla IRON. Petar Petrović, 0601234567, Test 12, Beograd, Vračar.'}],orders:[]};let sent;
 const i={...input,guestEmail:null,shipping:{...input.shipping,city:'Beograd',postalCode:null}};
 const r=await prepareStaffOrder({event,state:context,model:'test',extractFn:async()=>({input:i,reason:'',agreedTotal:null,priceEvidence:null,unitPrices:[],deliveryNotes:[]}),cartCheckFn:async()=>({ok:true}),spc:async p=>{
 if(p.action==='search')return {ok:true,items:[{sku:'IRON',name:'Pegla',price:1000,available:true}]};
 if(p.action==='quote'){sent=p.input;return {ok:true,quoteToken:'q',totals:{total:1000}};}return {ok:true};
 }});
 assert.equal(r.ok,true);assert.equal(sent.shipping.city,'Beograd (Vračar)');assert.equal(sent.guestEmail,null);
});
