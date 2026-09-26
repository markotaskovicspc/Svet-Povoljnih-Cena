import assert from 'node:assert/strict';
import {draftEmail} from '../src/email-draft-agent.mjs';
import {confirmationIntent} from '../src/email-actions.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const common={history:[],context:{ok:true,orders:[{number:'SPC-TEST-1',status:'KREIRANO',items:[{sku:'IRON',name:'Pegla',qty:1}]}]},spc:async()=>({ok:true,items:[]}),model};
const calls=[];
const result=await draftEmail({...common,message:{sender:'synthetic@example.test',subject:'Otkazivanje',text:'Molim otkažite celu porudžbinu SPC-TEST-1.',attachments:[]},prepareAction:async input=>{calls.push(input);return {ok:true,kind:'cancel',summary:'Potvrdite otkazivanje SPC-TEST-1.',token:'synthetic'};}});
assert.equal(calls[0]?.action,'prepare_cancel');assert.equal(result.operation?.kind,'cancel');
for(const [text,status,action] of [
 ['Pegla IRON iz SPC-TEST-1 ne greje. Jedan komad, želim zamenu.','ISPORUCENO','prepare_claim'],
 ['Naručujem jedan komad pegle IRON. Petar Petrović, 0601234567, Test ulica 12, 11000 Beograd. Kurir, pouzećem gotovina.','KREIRANO','prepare_purchase'],
]){
 const prepared=[];
 await draftEmail({...common,context:{ok:true,orders:[{...common.context.orders[0],status}]},spc:async()=>({ok:true,items:[{sku:'IRON',name:'Pegla',price:1000,available:true}]}),message:{sender:'synthetic@example.test',subject:'Zahtev',text,attachments:[]},prepareAction:async input=>{prepared.push(input);return {ok:true,kind:action,summary:'Synthetic summary',token:'synthetic'};}});
 assert.equal(prepared[0]?.action,action);
}
for(const [text,expected] of [['Da, otkažite.','confirm'],['Ne otkazujte','decline'],['Da, ali samo jednu peglu','change'],['Koliko traje?','question']]){
 const intent=await confirmationIntent({message:{text},operation:{summary:'Otkazivanje cele porudžbine SPC-TEST-1, pegla x 2.',kind:'cancel'},model});assert.equal(intent,expected);
}
console.log('Synthetic purchase, cancellation, claim tools and four confirmation intents passed; no ERP or mailbox writes.');
