import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents} from '../src/security.mjs';
import {isStaffOrderCommand,prepareStaffOrder,executeStaffOrder} from '../src/staff-order.mjs';
import {productOffer} from '../src/product-media.mjs';
const input={guestEmail:'buyer@example.com',shipping:{firstName:'Petar',lastName:'Petrović',phone:'0601234567',street:'Test',houseNumber:'12',city:'Kragujevac',postalCode:'34000'},lines:[{sku:'IRON',qty:1}],paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR'};
const event={id:'command-1',channel:'facebook',conversation:'page:buyer',echo:true,text:'/porudzbina',timestamp:Date.now()};
const state=()=>({history:[{role:'user',content:'Želim jednu peglu IRON. Petar Petrović, 0601234567, Test 12, Kragujevac 34000, buyer@example.com, pouzećem.',timestamp:Date.now()-1000}],orders:[]});
test('only native outgoing page command is privileged; customer, bot, other app and spoofed echoes are not',()=>{
 const envelope=message=>({object:'page',entry:[{id:'page',messaging:[{sender:{id:'page'},recipient:{id:'buyer'},timestamp:Date.now(),message:{mid:'test',is_echo:true,text:'/porudzbina',...message}}]}]});
 const parse=body=>parseEvents(body,[{id:'page',channel:'facebook'}]);
 assert(isStaffOrderCommand(parse(envelope({}))[0]));
 for(const message of [{metadata:'spc-bot'},{app_id:'other-app'},{text:'Kupac kaže /porudzbina'}])assert(!isStaffOrderCommand(parse(envelope(message))[0]));
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
