import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshCatalogContext} from '../src/catalog-context.mjs';
test('replaces a false previous product description with the current exact SKU',async()=>{
 const calls=[];const result=await refreshCatalogContext({state:{history:[{role:'assistant',content:'100032 muške 499 RSD'}]},event:{text:'Može'},spc:async p=>{calls.push(p);return {items:[{sku:'100032',name:'Ženske slip',price:449,slug:'actual',available:true,checkedQuantity:1}]};}});
 assert.equal(result[0].name,'Ženske slip');assert.equal(result[0].price,449);assert.equal(calls.length,1);
});
test('missing SKU is explicit, duplicates bounded and other search results are never substituted',async()=>{
 const result=await refreshCatalogContext({state:{history:[{content:'100032 100032'}]},event:{text:'100033'},spc:async()=>({items:[{sku:'OTHER',name:'Other'}]})});
 assert.deepEqual(result,[{sku:'100032',notFound:true},{sku:'100033',notFound:true}]);
});
