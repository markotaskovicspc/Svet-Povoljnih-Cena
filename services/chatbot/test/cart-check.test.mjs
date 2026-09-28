import test from 'node:test';
import assert from 'node:assert/strict';
import {validCartEvidence} from '../src/cart-check.mjs';
test('quantity and item can be grounded in separate customer messages; every quote must exist',()=>{
 const messages=['Poručila bih jedan kom na adresu\nTest Kupac','Urban seat','Da','Jeste Borča'];
 const items=[{sku:'110087',qty:1}];
 const checked={matches:true,evidence:[{sku:'110087',qty:1,customerQuotes:['Poručila bih jedan kom na adresu','Urban seat','Da']}]};
 assert(validCartEvidence(checked,items,messages));
 assert(!validCartEvidence(checked,[{sku:'110087',qty:2}],messages));
 assert(!validCartEvidence({...checked,matches:false},items,messages));
 for(const customerQuotes of [[],['Urban seat','Dva komada'],['Urban seat','Prodavac predlaže jedan']])assert(!validCartEvidence({...checked,evidence:[{sku:'110087',qty:1,customerQuotes}]},items,messages));
});
