import assert from 'node:assert/strict';import{prepareStaffOrder}from'../src/staff-order.mjs';
const history=[
 ['user','Poručila bih jedan kom na adresu\nTest Kupac\nTest ulica 29\n11211 Beograd'],
 ['assistant','Broj telefona, mejl i način plaćanja?'],['user','0600000000\ntest@example.com\nPouzećem'],
 ['assistant','Koji proizvod želite?'],['user','Urban seat'],
 ['assistant','Trpezarijska stolica URBAN SEAT (110087)\nCena: 1.499 din.'],['user','Da'],
 ['assistant','Da li je adresa Borča, Test ulica 29, 11211?'],['user','Jeste Borča'],
 ['assistant','Treba mi potvrda artikla i količine.'],['assistant','Ah sad videh da ste tražili jedan komad. Pravim porudzbinu.'],
 ['assistant','/porudzbina'],['assistant','Porudžbina nije kreirana: provera nije pouzdano izdvojila dogovorenu cenu iz prepiske.'],
 ['assistant','URBAN SEAT (110087)\nCena: 1.499 din.'],['assistant','/porudzbina'],
 ['assistant','Porudžbina nije kreirana: iz poslednjeg dogovora nije jasno koji artikal, varijantu ili količinu kupac želi.'],
].map(([role,content],i)=>({role,content,timestamp:Date.now()-100000+i*1000}));
const actions=[];const result=await prepareStaffOrder({event:{channel:'facebook',conversation:'synthetic:staff-split',text:'/porudzbina'},state:{history,orders:[]},model:process.env.OPENAI_MODEL??'gpt-5.4-mini',spc:async p=>{
 actions.push(p.action);if(p.action==='search')return {ok:true,items:[{sku:'110087',name:'Trpezarijska stolica URBAN SEAT',price:1499,available:true}]};
 assert.equal(p.action,'quote');assert.deepEqual(p.input.lines,[{sku:'110087',qty:1}]);assert.equal(p.input.shipping.city,'Borča');
 return {ok:true,input:p.input,totals:{shipping:299,total:1798},quoteToken:'synthetic'};
},onPlan:p=>console.log(JSON.stringify({lines:p.input?.lines,unitPrices:p.unitPrices,agreedTotal:p.agreedTotal,reason:p.reason}))});
console.log(JSON.stringify({ok:result.ok,message:result.message,actions,synthetic:true}));assert(result.ok);
