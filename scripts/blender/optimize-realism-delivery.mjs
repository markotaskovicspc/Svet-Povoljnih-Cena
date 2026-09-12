/** Compress supplementary surface maps; preserve reconstructed albedo bytes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const packages=[['cube-210030','cube-v7'],['x-desk-210027','x-desk-v3']];
const report=[];
async function jpeg(bytes,name) {
 const normal=/normal/i.test(name);
 const jpg=await sharp(bytes).jpeg({quality:normal?98:94,chromaSubsampling:'4:4:4'}).toBuffer();
 const a=await sharp(bytes).removeAlpha().raw().toBuffer(),b=await sharp(jpg).removeAlpha().raw().toBuffer();
 assert.equal(a.length,b.length);let sq=0,abs=0;
 for(let i=0;i<a.length;i++){let d=a[i]-b[i];sq+=d*d;abs+=Math.abs(d);}
 const psnr=10*Math.log10(255**2/(sq/a.length));assert.ok(psnr>(normal?42:40),`${name}: ${psnr} dB`);
 report.push({name,originalBytes:bytes.length,bytes:jpg.length,psnrDb:psnr,meanAbsoluteRgbDifferenceOf255:abs/a.length});return jpg;
}
for(const [folder,stem] of packages) {
 const filename=`public/models/${folder}/${stem}.glb`,bytes=await fs.readFile(filename);
 const n=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+n)),bin=bytes.subarray(28+n);
 const baseIndices=new Set(j.materials.flatMap(m=>m.pbrMetallicRoughness?.baseColorTexture?[j.textures[m.pbrMetallicRoughness.baseColorTexture.index].source]:[]));
 const replace=new Map();
 for(const [i,image] of j.images.entries()) if(!baseIndices.has(i)&&image.mimeType==='image/png') {
  const v=j.bufferViews[image.bufferView];replace.set(image.bufferView,await jpeg(bin.subarray(v.byteOffset,v.byteOffset+v.byteLength),`${stem}/${image.name}`));image.mimeType='image/jpeg';
 }
 let offset=0;const pieces=[];
 for(const [i,v] of j.bufferViews.entries()) {
  const b=replace.get(i)||bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);v.byteOffset=offset;v.byteLength=b.length;pieces.push(b);offset+=b.length;const pad=(4-offset%4)%4;pieces.push(Buffer.alloc(pad));offset+=pad;
 }
 j.buffers[0].byteLength=offset;const text=Buffer.from(JSON.stringify(j)),json=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),binary=Buffer.concat(pieces);
 const h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+binary.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);
 await fs.writeFile(filename,Buffer.concat([h,json,bh,binary]));
 const work=path.resolve(`.tools/realism/package-${stem}`);await fs.mkdir(work,{recursive:true});execFileSync('unzip',['-qo',`public/models/${folder}/${stem}.usdz`,'-d',work]);
 const replacements={};
 for(const f of await fs.readdir(`${work}/textures`)) if(f.endsWith('.png')) {
  const out=f.replace(/\.png$/,'.jpg');await fs.writeFile(`${work}/textures/${out}`,await jpeg(await fs.readFile(`${work}/textures/${f}`),`${stem}/USDZ/${f}`));replacements[`textures/${f}`]=`textures/${out}`;
 }
 await fs.writeFile(`${work}/replacements.json`,JSON.stringify(replacements));
}
await fs.writeFile('assets/material-library/realism-v1/compression-report.json',JSON.stringify(report,null,2)+'\n');
console.log(report.map(r=>({name:r.name,bytes:r.bytes,psnrDb:r.psnrDb})));
