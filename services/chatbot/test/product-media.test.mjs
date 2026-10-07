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

test('unavailable loyalty product has no purchase invitation',()=>{
 const caption=productPresentation({sku:'FRY',name:'Friteza',price:4284,loyaltyPrice:2999,available:false}).caption;
 assert.match(caption,/nije dostupno/);assert.match(caption,/2.999/);assert.doesNotMatch(caption,/Da li želite|možete poručiti/);
});
