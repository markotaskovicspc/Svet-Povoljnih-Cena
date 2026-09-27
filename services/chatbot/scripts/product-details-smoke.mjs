import assert from 'node:assert/strict';
import {answer} from '../src/agent.mjs';
import {draftEmail} from '../src/email-draft-agent.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const product={sku:'TEST-FEN',name:'Fen BREEZE',slug:'test-fen',price:1000,available:true};
const history=[{role:'user',content:'Zanima me fen BREEZE.'},{role:'assistant',content:'Fen BREEZE, šifra TEST-FEN, je dostupan.'}];
for(const channel of ['facebook','instagram','email'])for(const known of [true,false]){
 const calls=[];const spc=async p=>{calls.push(p);if(p.action==='search')return {ok:true,items:[product]};if(p.action==='product_details'){assert.equal(p.sku,'TEST-FEN');return {ok:true,product:{...product,description:known?'Dimenzije samog fena: dužina 23 cm i visina 21 cm. Snaga 2000 W.':'Snaga 2000 W.',dimensions:null,packageDimensions:{width:30,depth:12,height:25,unit:'cm'},technicalSpecs:[]}};}throw Error('Only read operations allowed');};
 const text='lep je fen koje su mu dimenyije?';
 const result=channel==='email'?await draftEmail({message:{text},history,context:{orders:[]},spc,model}):await answer({event:{channel,text},state:{history,orders:[]},spc,model});
 const body=result.text??result.body;assert(calls.some(p=>p.action==='product_details'),channel+' must read details');
 if(known){assert(body.includes('23')&&body.includes('21'),body);}else{assert(!/\b(23|21)\b/.test(body),body);assert(/nisu|nije|nema|naveden|pakovanj|ambalaž/i.test(body),body);}
 assert(!body.includes('svežem rezultatu'));console.log(channel,known?'description dimensions':'missing dimensions',body);
}
