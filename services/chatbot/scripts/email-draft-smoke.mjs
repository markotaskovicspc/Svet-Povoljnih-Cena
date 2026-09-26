import assert from 'node:assert/strict';
import {draftEmail} from '../src/email-draft-agent.mjs';
const common={history:[],context:{ok:true,orders:[{number:'SPC-2026-001234',status:'KREIRANO',items:[{sku:'IRON',name:'Pegla',qty:1}]}]},spc:async()=>({ok:true,items:[]}),model:process.env.OPENAI_MODEL??'gpt-5.4-mini'};
for(const text of ['Gde je moja porudžbina SPC-2026-001234?','Otkažite SPC-2026-001234 i vratite mi novac.','Pegla iz SPC-2026-001234 ne radi, hoću reklamaciju.']){
 const result=await draftEmail({...common,message:{sender:'synthetic@example.test',subject:'Pitanje',text,attachments:[]}});
 assert.equal(result.action,'draft');assert(!/je otkazana|novac je vraćen|tiket je otvoren|je isporučena/i.test(result.body));console.log(JSON.stringify({test:text,result}));
}
