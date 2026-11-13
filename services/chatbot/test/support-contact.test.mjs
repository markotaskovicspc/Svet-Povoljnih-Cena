import test from 'node:test';import assert from 'node:assert/strict';
import {receiveSupportContact,requestSupportContact,wantsHuman,appendSupportContact,guardSupportContact} from '../src/support-contact.mjs';
const event={channel:'web',text:'ovo je užasno kada je nekome potrebna pomoć prave osobe'};

test('ordinary product questions and uncertain ERP writes are not intercepted',()=>{
 assert(!wantsHuman('Koliko je dostava?'));assert(!wantsHuman('Ne želim čoveka'));
 assert.equal(receiveSupportContact({state:{confirming:{}},event}),null);
 assert.equal(receiveSupportContact({state:{},event:{channel:'web',text:'Ne radi grejalica'}}),null);
});

for(const channel of ['web','facebook','instagram']){
 test(`${channel} handoff continues in chat without asking for callback email`,()=>{
  const state={pending:{},loyaltyPending:{}};
  const reply=receiveSupportContact({state,event:{...event,channel}});
  assert.match(reply,/ovde u razgovoru/);assert.doesNotMatch(reply,/mejl|email|adresu/);
  assert(state.supportRequest);assert(!state.supportContact);assert(!state.pending);assert(!state.loyaltyPending);
  assert.equal(requestSupportContact({state,event:{...event,channel}}),null);
 });
 test(`${channel} clears an old callback wait and ignores it for new messages`,()=>{
  const state={supportContact:{askedAt:123,waiting:true}};
  assert.equal(receiveSupportContact({state,event:{channel,text:'buyer@example.com'}}),null);
  assert.equal(state.supportContact.waiting,false);assert(!state.supportRequest);assert(!state.supportContact.email);
 });
 test(`${channel} removes a model callback question while preserving the product answer`,()=>{
  assert.equal(appendSupportContact('Materijal proverava podrška. Na koju mejl adresu da Vam javimo?',null), 'Materijal proverava podrška.');
  assert.equal(guardSupportContact({channel,text:'Materijal proverava podrška. Ostavite mejl adresu za odgovor.',state:{lastSupportRequest:{}}}),'Materijal proverava podrška.');
 });
}

test('support follow-ups preserve identity verification and loyalty questions',()=>{
 const text='Materijal proverava podrška. Ostavite mejl adresu za odgovor.';
 for(const protectedState of [{claimVerification:{}},{reclamation:{}},{loyaltyPending:{}}])assert.equal(guardSupportContact({channel:'facebook',text,state:{lastSupportRequest:{},...protectedState}}),text);
});
