import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents} from '../src/security.mjs';
import {receiveAdContext} from '../src/ad-context.mjs';
const accounts=[{channel:'facebook',id:'123'}];
const referral={source:'ADS',ad_id:'42',ads_context_data:{ad_title:'Sto HOME STYLE',post_id:'123_456',photo_url:'https://scontent.fbcdn.net/photo.jpg'}};
test('ad metadata survives message and standalone referral; receipt-only events do not become chats',()=>{
 const payload=event=>({object:'page',entry:[{id:'123',messaging:[{sender:{id:'456'},recipient:{id:'123'},timestamp:12345,...event}]}]});
 assert.equal(parseEvents(payload({message:{mid:'m1',text:'Ovo?',referral}}),accounts)[0].referral.title,'Sto HOME STYLE');
 const first=parseEvents(payload({referral}),accounts)[0];assert(first.referralOnly);assert.equal(first.id,parseEvents(payload({referral}),accounts)[0].id);
 assert.equal(parseEvents(payload({delivery:{mids:['m1']}}),accounts).length,0);
});
test('failed post read retains bounded title and image description, with no signed image URLs in state',async()=>{
 const state={};await receiveAdContext({state,event:{id:'x',timestamp:12345,referral:{adId:'42',title:'HOME STYLE',postId:'123_456',photoUrl:'https://scontent.fbcdn.net/a'}},account:{token:'secret'},graphVersion:'v26.0',fetchFn:async()=>({ok:false}),vision:{read:async()=>({images:[{objects:[{visibleName:'HOME STYLE'}]}]})}});
 assert.equal(state.adOrigin.title,'HOME STYLE');assert(!JSON.stringify(state).includes('secret'));assert(!JSON.stringify(state).includes('https:'));
});
