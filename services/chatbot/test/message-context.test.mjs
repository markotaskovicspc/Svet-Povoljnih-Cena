import test from 'node:test';
import assert from 'node:assert/strict';
import {productAttachments,reactionOnly,messageBurst,conversationMessages} from '../src/message-context.mjs';
import {parseEvents} from '../src/security.mjs';

test('Meta sticker and duplicate image never count as product photos',()=>{
 const attachments=[{type:'image',url:'thumb'},{type:'sticker',url:'thumb'}];
 assert(reactionOnly({attachments}));assert.deepEqual(productAttachments({attachments}),[]);
 assert(!reactionOnly({text:'Drugu stolicu',attachments}));
 assert.deepEqual(productAttachments({attachments:[...attachments,{type:'image',url:'chair'}]}),[{type:'image',url:'chair'}]);
 const [event]=parseEvents({object:'page',entry:[{id:'p',messaging:[{sender:{id:'u'},recipient:{id:'p'},timestamp:Date.now(),message:{mid:'m',sticker_id:123,attachments:[{type:'image',payload:{url:'thumb'}}]}}]}]},[{id:'p',channel:'facebook'}]);
 assert(reactionOnly(event));
});
test('burst combines only adjacent short customer text, never commands or images',()=>{
 const e=(text,timestamp=1000)=>({text,timestamp,attachments:[]});
 assert.equal(messageBurst([e('6'),e('kom',1200),e('Adresa',5000)]).length,2);
 assert.equal(messageBurst([e('Da'),{...e('/porudzbina'),echo:true},e('6')]).length,1);
 assert.equal(messageBurst([e('6'),{...e(''),attachments:[{type:'image'}]}]).length,1);
});
test('human provenance is retained without rewriting customer or bot content',()=>{
 const history=[{role:'assistant',content:'Sedište je plastično.',source:'staff'},{role:'user',content:'Hvala'},{role:'assistant',content:'Cena je 699.'}];
 const rendered=conversationMessages(history);assert.match(rendered[0].content,/Odgovor zaposlenog/);assert.equal(history[0].content,'Sedište je plastično.');assert.equal(rendered[1].content,'Hvala');assert.equal(rendered[2].content,'Cena je 699.');
});
