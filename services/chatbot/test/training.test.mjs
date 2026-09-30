import test from 'node:test';import assert from 'node:assert/strict';
import {selectTown} from '../src/delivery.mjs';import {createSpcClient} from '../src/spc.mjs';
import {conversationLink} from '../src/inbox-link.mjs';import {findVisualCandidates} from '../src/visual-candidates.mjs';
import {beginReclamation} from '../src/reclamation.mjs';import {suppliedContact} from '../src/staff-order.mjs';import {quoteMessage} from '../src/agent.mjs';
test('absent postcode is resolved only for a unique town and no email is invented',async()=>{
 const town={name:'Borča',townId:1,postalCode:'11211'};
 assert.equal(selectTown([town],{city:'Borca'}),town);assert.equal(selectTown([town,{...town,townId:2}],{city:'Borča'}),null);
 const fetch=globalThis.fetch;globalThis.fetch=async(u,o)=>({ok:true,json:async()=>o?.body?JSON.parse(o.body):{items:[town]}});
 try{const result=await createSpcClient('https://example.test','secret')({action:'quote',input:{guestEmail:null,shipping:{city:'Borča',postalCode:null},shippingMethod:'KURIR'}});assert.equal(result.input.shipping.postalCode,'11211');assert(!('guestEmail'in result.input));}finally{globalThis.fetch=fetch;}
 const input={guestEmail:null,shipping:{firstName:'Test',lastName:'Kupac',phone:'0601234567',street:'Test ulica',houseNumber:'1',city:'Borča',postalCode:null},lines:[{sku:'CHAIR',qty:1}],shippingMethod:'KURIR',paymentMethod:'POUZECE_GOTOVINA'};
 assert(suppliedContact(input,[{content:'Test Kupac 0601234567 Test ulica 1 Borča'}]));assert(!suppliedContact({...input,shipping:{...input.shipping,phone:''}},[{content:'Test Kupac Test ulica 1 Borča'}]));
 const text=quoteMessage({input:{...input,shipping:{...input.shipping,postalCode:'11211'}},totals:{total:1798,shipping:299}});assert(!/Mejl:|null|undefined/.test(text));
});
test('inbox link uses Meta resolved inbox item, never PSID, and rejects foreign links',async()=>{
 const params={account:{channel:'facebook',id:'123',token:'secret'},sender:'456',graphVersion:'v26.0'};
 const link=await conversationLink({...params,fetchFn:async()=>({ok:true,json:async()=>({data:[{link:'/123/inbox/789/?section=messages'}]})})});assert.equal(new URL(link).searchParams.get('selected_item_id'),'789');assert(!link.includes('secret'));
 assert.equal(await conversationLink({...params,fetchFn:async()=>({ok:true,json:async()=>({data:[{link:'https://evil.test/123/inbox/789/'}]})})}),null);
});
test('open reclamation returns existing case and forwards supplement without preparing a duplicate',async()=>{
 const state={orders:[{number:'SPC-TEST',accessToken:'test'}],history:[],pending:{quoteToken:'old-purchase'}};let calls=0;
 const r=await beginReclamation({number:'SPC-TEST',sku:'CHAIR',event:{channel:'facebook',conversation:'test'},state,spc:async()=>{calls++;return {ok:true,order:{number:'SPC-TEST',status:'ISPORUCENO',items:[{sku:'CHAIR',qty:1}],reclamations:[{sku:'CHAIR',number:'R-1',status:'U_OBRADI'}]}};}});
 assert.equal(r.existingReclamation.number,'R-1');assert.equal(calls,1);assert(!state.reclamation);assert(!state.pending);assert.match(state.supportRequest.reason,/R-1/);
});
test('visual selection is tied to the selected object and only catalog SKUs survive comparison',async()=>{
 const state={visualContext:{createdAt:Date.now(),images:[{imageNumber:1,objects:[{position:'gore levo',description:'pegla'},{position:'gore desno',description:'bela stolica',visibleName:'',visibleSku:''}]}]}};
 const result=await findVisualCandidates({state,imageNumber:1,objectNumber:2,query:'stolica',spc:async()=>({items:[{sku:'REAL',name:'Stolica'}]}),rank:async({object})=>{assert.equal(object.description,'bela stolica');return {candidates:[{sku:'INVENTED'},{sku:'REAL',reason:'sličan naslon'}],uncertain:true};}});
 assert.deepEqual(result.candidates.map(x=>x.sku),['REAL']);assert(result.uncertain);
 assert(!(await findVisualCandidates({state,imageNumber:1,objectNumber:3,query:'stolica'})).ok);
});
