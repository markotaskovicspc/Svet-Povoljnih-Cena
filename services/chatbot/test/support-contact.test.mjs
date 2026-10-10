import test from 'node:test';import assert from 'node:assert/strict';
import {receiveSupportContact,requestSupportContact,wantsHuman,appendSupportContact} from '../src/support-contact.mjs';
const event={text:'ovo je užasno kada je nekome potrebna pomoć prave osobe'};
test('explicit human request interrupts an unconfirmed offer and asks for callback contact once',()=>{
 const state={pending:{},loyaltyPending:{}};
 assert.match(receiveSupportContact({state,event}),/na koju adresu/);assert(!state.pending);assert(!state.loyaltyPending);assert(state.supportRequest);assert(state.supportContact.waiting);
 state.lastSupportRequest={reason:state.supportRequest.reason};delete state.supportRequest;
 assert(!receiveSupportContact({state,event}).includes('Na koju mejl'));assert(!state.supportRequest);
 assert.match(receiveSupportContact({state,event:{text:'Javite mi na Buyer@Example.com'}}),/zabeležio sam mejl/);
 assert.equal(state.supportContact.email,'buyer@example.com');assert(state.supportRequest.contactUpdate);
});
test('refusal is optional, and known contact is reused without another question',()=>{
 const state={};requestSupportContact({state,event});
 assert.match(receiveSupportContact({state,event:{text:'Nemam mejl'}}),/mejl nije obavezan/);
 assert.equal(requestSupportContact({state,event}),null);
 const known={customer:{guestEmail:'buyer@example.com'}};assert.equal(requestSupportContact({state:known,event}),null);assert.equal(known.supportContact.email,'buyer@example.com');
});
test('handoff keeps product answer but asks for optional email only once',()=>{
 const question=requestSupportContact({state:{},event:{text:'proverite'}});
 const result=appendSupportContact('Dostava je obično 2–3 dana. Na koju mejl adresu podrška može da Vam se javi?',question);
 assert.match(result,/2–3 dana/);assert.equal((result.match(/\?/g)??[]).length,1);
 assert.match(result,/Možete nastaviti i ovde/);assert(!/kolega|kolege/.test(result));
});
test('ordinary product questions, malformed contacts, and uncertain ERP writes are not intercepted',()=>{
 assert(!wantsHuman('Koliko je dostava?'));assert(!wantsHuman('Ne želim čoveka'));
 assert.equal(receiveSupportContact({state:{confirming:{}},event}),null);
 const state={};requestSupportContact({state,event});assert.equal(receiveSupportContact({state,event:{text:'x@broken'}}),null);assert(!state.supportContact.email);
 assert.equal(receiveSupportContact({state,event:{text:'Ne radi grejalica'}}),null);assert.equal(state.supportContact.waiting,true);
});
