import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedImageUrl,loadMetaImage,receiveProductImages,activeVisualContext,visualSelectionPresented,VISION_TTL} from '../src/vision.mjs';

test('only HTTPS Meta media hosts, including validated redirects, can be fetched',async()=>{
 for(const url of ['https://scontent.xx.fbcdn.net/a','https://lookaside.fbsbx.com/a','https://scontent.cdninstagram.com/a'])assert(allowedImageUrl(url));
 for(const url of ['http://scontent.xx.fbcdn.net/a','https://fbcdn.net.attacker.test/a','https://localhost/a','https://127.0.0.1/a','https://user:pass@fbcdn.net/a','https://fbcdn.net:8080/a'])assert(!allowedImageUrl(url));
 let calls=0;await assert.rejects(()=>loadMetaImage('https://fbcdn.net/a',async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/secret'}});}),/HOST_REJECTED/);assert.equal(calls,1);
});
test('bad MIME, excessive length and fake image bodies are rejected',async()=>{
 for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('x',{headers:{'content-type':'image/png','content-length':9000000}}),new Response('not a PNG',{headers:{'content-type':'image/png'}})])await assert.rejects(()=>loadMetaImage('https://fbcdn.net/a',async()=>response));
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 assert.match(await loadMetaImage('https://fbcdn.net/a',async()=>new Response(png,{headers:{'content-type':'image/png'}})),/^data:image\/png;base64,/);
});
test('image positions survive later text and retry without persisting image bytes or URLs',async()=>{
 const state={history:[]};const event={id:'image1',timestamp:Date.now(),attachments:[{type:'image',url:'https://fbcdn.net/private-signed-url'}]};let calls=0;
 const describe=async()=>{calls++;return {readable:true,objects:[{position:'gore levo',description:'crna pegla',visibleName:'',visibleSku:''}],uncertainty:''};};
 await receiveProductImages({state,event,load:async()=> 'data:image/png;base64,secretbytes',describe});
 await receiveProductImages({state,event,load:async()=>{throw Error('should not refetch');},describe});
 assert.equal(calls,1);assert.equal(activeVisualContext(state).images[0].objects[0].position,'gore levo');
 assert(!JSON.stringify(state).includes('secretbytes'));assert(!JSON.stringify(state).includes('private-signed-url'));
 assert.equal(activeVisualContext(state,event.timestamp+VISION_TTL+1),null);
 const items=[{sku:'IRON',name:'Pegla'}];assert.equal(visualSelectionPresented(state,items),false);
 state.history.push({role:'assistant',content:'Pegla (IRON), mislite na ovaj artikal?',timestamp:event.timestamp+1});assert.equal(visualSelectionPresented(state,items),true);
});
test('new or unreadable image replaces old product context and stays recoverable',async()=>{
 const state={visualContext:{eventId:'old',createdAt:Date.now(),images:[{objects:[{description:'krevet'}]}]}};
 await receiveProductImages({state,event:{id:'new',timestamp:Date.now(),attachments:[{type:'image',url:'bad'}]},load:async()=>{throw Error('expired');}});
 assert.equal(state.visualContext.eventId,'new');assert.deepEqual(state.visualContext.images,[]);assert.equal(state.visualContext.failed,1);
});
test('later photo does not invalidate a named and accepted product in current purchase',()=>{
 const at=Date.now();const state={orders:[],history:[
 {role:'assistant',content:'Fen TURBO AIR (FEN). Da li je to taj?',timestamp:at-3000},
 {role:'user',content:'Da',timestamp:at-2000},
 {role:'assistant',content:'Adresa?',timestamp:at-1000}],
 visualContext:{createdAt:at,images:[{objects:[]}]}};
 assert.equal(visualSelectionPresented(state,[{sku:'FEN',name:'Fen TURBO AIR'}]),true);
 state.history[1].content='Ne, drugi fen';
 assert.equal(visualSelectionPresented(state,[{sku:'FEN',name:'Fen TURBO AIR'}]),false);
 state.history[1].content='Da';state.orders=[{number:'SPC-OLD'}];
 state.history.push({role:'assistant',content:'Porudžbina SPC-OLD je uspešno kreirana.',timestamp:at-500});
 assert.equal(visualSelectionPresented(state,[{sku:'FEN',name:'Fen TURBO AIR'}]),false);
});
