import assert from 'node:assert/strict';
import {prepareCommentReply} from '../src/comments.mjs';
const product={sku:'210026',name:'Kompjuter sto LOFT – 80x40',price:1999,slug:'synthetic-loft',available:true,checkedQuantity:1};
for(const scenario of [
 {text:'Cena?',post:'Kompjuter sto LOFT 80x40, šifra 210026.',kind:'sales',sku:'210026'},
 {text:'Koja je cena stola Loft?',post:'Dobar radni sto ne mora da zauzme pola sobe. LOFT daje praktičan prostor za laptop, posao ili učenje.',kind:'sales',sku:'210026',sharedModel:true},
 {text:'Koliko je visok?',post:'Kompjuter sto LOFT 80x40, šifra 210026.',kind:'sales',details:true},
 {text:'@Ana @Marija 😍',post:'Kompjuter sto LOFT',kind:'ignore'},
 {text:'Stigao mi je polomljen sto, niko mi ne odgovara!',post:'Kompjuter sto LOFT',kind:'support'},
 {text:'Cena?',post:'Naša kolekcija stolova i stolica za dom!',kind:'sales',unknown:true},
 {text:'Ne šaljite mi privatne poruke, odgovorite ovde.',post:'Kompjuter sto LOFT',kind:'ignore'},
 ]){
 const calls=[];const spc=async p=>{calls.push(p);if(p.action==='search')return {ok:true,items:scenario.unknown?[]:scenario.sharedModel?(/^loft$/i.test(p.query)?[product,{sku:'210029',name:'Otvorena polica LOFT – 145x50x30',price:5713,available:true,checkedQuantity:1}]:p.query==='210026'?[product]:[]):[product]};if(p.action==='product_details')return {ok:true,product:{...product,description:'Visina stola je 74 cm.',dimensions:{width:80,depth:40,height:74,unit:'cm'}}};throw Error('No ERP writes in smoke test');};
 const r=await prepareCommentReply({event:{text:scenario.text},post:{text:scenario.post},spc,model:process.env.OPENAI_MODEL??'gpt-5.4-mini'});
 console.log(JSON.stringify({scenario:scenario.text,...r,tools:calls.map(c=>c.action)}));
 assert.equal(r.kind,scenario.kind);if(scenario.sku)assert.equal(r.sku,scenario.sku);if(scenario.details){assert(calls.some(p=>p.action==='product_details'));assert(r.text.includes('74'));}if(scenario.unknown){assert.equal(r.sku,null);assert(!r.text.includes('1999'));}
}
