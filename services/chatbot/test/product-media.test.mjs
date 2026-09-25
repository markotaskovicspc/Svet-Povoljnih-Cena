import test from 'node:test';
import assert from 'node:assert/strict';
import {productPresentation} from '../src/product-media.mjs';
test('only public product media is attached; missing or private media retains product link',()=>{
 const product={sku:'1',name:'Stolica',price:1499,slug:'stolica'};
 const publicUrl='https://vyebjbcfhgujlvjnoxpl.supabase.co/storage/v1/object/public/product-media/stolica.png';
 assert.equal(productPresentation({...product,image:{url:publicUrl}}).imageUrl,publicUrl);
 for(const url of [undefined,'http://localhost/test','https://example.com/test.png',publicUrl.replace('product-media','order-receipts'),publicUrl+'?token=private']){
  const result=productPresentation({...product,image:{url}});
  assert.equal(result.imageUrl,null);assert.equal(result.url,'https://www.svetpovoljnihcena.rs/p/stolica');
 }
});
