import assert from 'node:assert/strict';import sharp from 'sharp';
import {describeImage} from '../src/vision.mjs';import {prepareCommentReply} from '../src/comments.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
// Synthetic advertisement: positions and printed price differ from the current ERP price.
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="900"><rect width="700" height="900" fill="white"/><path d="M150 240 L470 240 L370 130 L210 130 Z" fill="#343434"/><path d="M220 130 L220 75 L355 75 L380 140" fill="none" stroke="#555" stroke-width="24"/><text x="95" y="300" font-size="30">GOLDCORE pegla - 210005</text><text x="95" y="345" font-size="25">STARA CENA: 4999 DIN</text><rect x="200" y="470" width="170" height="170" fill="#557da0"/><rect x="190" y="640" width="200" height="35" fill="#557da0"/><path d="M210 675 L190 790 M370 675 L390 790" stroke="#222" stroke-width="14"/><text x="130" y="845" font-size="30">URBAN stolica - 330001</text></svg>`);
const image='data:image/png;base64,'+(await sharp(svg).png().toBuffer()).toString('base64');
const vision=await describeImage({image,model});console.log(JSON.stringify({vision}));assert(vision.readable);assert(vision.objects.some(o=>o.visibleSku==='210005'&&/gore|gorn|vrh/i.test(o.position)));assert(vision.objects.some(o=>o.visibleSku==='330001'));
const products=[{sku:'210005',name:'Pegla GOLDCORE',price:999,available:true,checkedQuantity:1},{sku:'330001',name:'Stolica URBAN',price:2000,available:true,checkedQuantity:1}];
const calls=[];const spc=async p=>{calls.push(p);if(p.action==='search')return {ok:true,items:products.filter(x=>(x.sku+' '+x.name).toLowerCase().includes(p.query.toLowerCase()))};if(p.action==='product_details')return {ok:true,product:products.find(x=>x.sku===p.sku)};throw Error('No ERP writes allowed');};
const post={text:'Izdvajamo iz ponude za dom.',visual:{images:[{imageNumber:1,preview:false,...vision}],failed:0,omitted:0}};
const chosen=await prepareCommentReply({event:{text:'Koliko košta ova skroz gore?'},post,spc,model});
assert.equal(chosen.sku,'210005');assert.match(chosen.text,/999/);assert(!chosen.text.includes('4999'));assert(calls.some(x=>x.action==='search'));
console.log(JSON.stringify({scenario:'image-only product identity and top position',...chosen}));
const ambiguous=await prepareCommentReply({event:{text:'Cena?'},post,spc,model});console.log(JSON.stringify({scenario:'collage with no selected product',...ambiguous}));assert.equal(ambiguous.kind,'sales');assert.equal(ambiguous.sku,null);
console.log('Vision + comment + ERP verified. No Meta messages, orders or emails sent.');
