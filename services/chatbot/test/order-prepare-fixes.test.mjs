import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpcClient,houseNumberForErp,validHouseNumber} from '../src/spc.mjs';
import {matchesEvidence} from '../src/cart-check.mjs';
import {visualSelectionPresented,namesProduct,rejectsNamedProduct} from '../src/vision.mjs';

test('apartment, entrance and floor words become a valid house number',()=>{
 for(const [raw,expected] of [['13 stan 1','13/1'],['13, stan 1','13/1'],['4a st. 9','4a/9'],['28 ulaz 2','28'],['15 sprat 3','15'],['b.b.','bb'],['033','33'],['40/63','40/63']]){
  assert.equal(houseNumberForErp(raw),expected,raw);
  assert.equal(validHouseNumber(houseNumberForErp(raw)),true,raw);
 }
 assert.equal(validHouseNumber('c/2'),false);
});

test('an invalid house number asks the buyer instead of an HTTP 400 handoff',async()=>{
 const original=globalThis.fetch;let posted=0;
 globalThis.fetch=async(url,options)=>{if(options?.body)posted++;return {ok:true,json:async()=>({items:[{townId:1,name:'Novi Pazar',postalCode:'36300'}]})};};
 try{
  const r=await createSpcClient('https://example.test','x')({action:'quote',input:{shipping:{city:'Novi Pazar',postalCode:'36300',street:'Jalija',houseNumber:'c/2'}}});
  assert.equal(r.error.code,'HOUSE_NUMBER_INVALID');assert.equal(posted,0);
 }finally{globalThis.fetch=original;}
});

test('ERP field validation (400) returns a question, not an exception',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>options?.body?{ok:false,status:400,json:async()=>({error:'INVALID'})}:{ok:true,json:async()=>({items:[{townId:1,name:'Novi Pazar',postalCode:'36300'}]})};
 try{
  const r=await createSpcClient('https://example.test','x')({action:'quote',input:{shipping:{city:'Novi Pazar',postalCode:'36300',street:'Jalija',houseNumber:'2'}}});
  assert.equal(r.ok,false);assert.equal(r.error.code,'INVALID_INPUT');
 }finally{globalThis.fetch=original;}
});

test('the seller may name only the model of the catalog product',()=>{
 const item={sku:'210019',name:'3u1 set za doručak BON APPETIT'};
 assert.equal(namesProduct('Da li mislite na BON APPETIT po 3.999 din?',item),true);
 assert.equal(namesProduct('Imamo i fritezu FRY SMART.',item),false);
});

test('a later non-rejecting reply keeps a named product after a new image',()=>{
 const now=Date.now();
 const state={visualContext:{createdAt:now,images:[]},history:[
  {role:'user',content:'[Prilog kupca]',timestamp:now-5000},
  {role:'assistant',content:'Da li mislite na BON APPETIT (210019)?',timestamp:now-4000},
  {role:'user',content:'Jeste taj, šaljite',timestamp:now-3000},
 ]};
 assert.equal(visualSelectionPresented(state,[{sku:'210019',name:'3u1 set za doručak BON APPETIT'}]),true);
 state.history[2].content='Ne, drugi';
 assert.equal(visualSelectionPresented(state,[{sku:'210019',name:'3u1 set za doručak BON APPETIT'}]),false);
 assert.equal(rejectsNamedProduct('nije to'),true);
});

test('quotes differing only in case, diacritics or punctuation still match',()=>{
 assert.equal(matchesEvidence('Hocu jos jedan mop',['Hoću još jedan MOP!']),true);
 assert.equal(matchesEvidence('Hocu dva kreveta',['Hoću još jedan MOP!']),false);
});
