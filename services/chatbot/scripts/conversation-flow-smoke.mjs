import assert from 'node:assert/strict';
import {answer} from '../src/agent.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const product={sku:'210026',name:'Kompjuter sto LOFT – 80x40',price:1999,available:true,checkedQuantity:1,slug:'test-loft'};
const history=[
 {role:'user',content:'Kupila bih ovaj stol za 1999 din'},
 {role:'assistant',content:'Koji tačno sto želite?'},
 {role:'user',content:'Kompjuterski stol LOFT za 1999 din, dimenzije 80-40'},
 {role:'assistant',content:'Kompjuter sto LOFT – 80x40 (210026) je 1.999 din. Da li želite da poručite ovaj artikal?'},
 {role:'user',content:'Da, na to mislim i poručila bih jedan.'},
 {role:'assistant',content:'Može, pošaljite mejl za porudžbinu.'},
];
const cases=[
 {name:'invalid email stays on purchase',text:'kupacć@gmail.com',detail:false,check:r=>{assert(/ć/.test(r.text),r.text);assert(/adres|mejl|email/i.test(r.text),r.text);assert(!/74|hrast|konstrukcij/.test(r.text),r.text);}},
 {name:'valid email advances to missing delivery details',text:'kupac@example.com',detail:false,check:r=>{assert(/ime|prezime|adres|telefon|dostav|ulic|mesto|količin/i.test(r.text),r.text);assert(!/74|hrast|konstrukcij/.test(r.text),r.text);assert(!/potvrdite.*mejl|tačan mejl|pošaljite.*mejl/i.test(r.text),r.text);}},
 {name:'email plus actual question stays flexible',text:'kupacć@gmail.com, a koliko je visok taj sto?',detail:true,check:r=>{assert(/74/.test(r.text),r.text);assert(/ć/.test(r.text),r.text);}},
 {name:'customer can change product while email is pending',text:'Ipak neću sto, trebaju mi dve Urban stolice.',detail:false,check:(r,calls)=>{assert(calls.some(c=>c.action==='search'&&/urban|110087/i.test(c.query)),r.text);assert(!/74|hrast/.test(r.text),r.text);}},
];
for(const [index,scenario] of cases.entries()){
 const calls=[];
 const spc=async p=>{
  calls.push(p);
  if(p.action==='search')return {ok:true,items:/urban|110087/i.test(p.query)?[{sku:'110087',name:'Trpezarijska stolica URBAN SEAT',price:1499,available:true,checkedQuantity:p.quantity??1,slug:'test-urban'}]:[product]};
  if(p.action==='product_details')return {ok:true,product:{...product,description:'Sto dimenzija 80x40 cm i visine 74 cm. Svetli hrast, crna metalna konstrukcija.',dimensions:{width:80,depth:40,height:74,unit:'cm'},technicalSpecs:[]}};
  throw Error(`Unexpected action in synthetic conversation: ${p.action}`);
 };
 const result=await answer({event:{channel:index%2?'instagram':'facebook',conversation:'synthetic-flow',text:scenario.text},state:{history:structuredClone(history),orders:[]},spc,model});
 assert.equal(result.quoteCreated,false);
 assert.equal(calls.some(c=>c.action==='product_details'),scenario.detail,scenario.name+': unexpected detail lookup');
 scenario.check(result,calls);
 console.log(JSON.stringify({scenario:scenario.name,reply:result.text,actions:calls.map(c=>c.action)}));
}
