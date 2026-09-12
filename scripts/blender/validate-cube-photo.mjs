import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateBytes } from 'gltf-validator';
const sha=b=>createHash('sha256').update(b).digest('hex');
function read(bytes){const len=bytes.readUInt32LE(12);return {json:JSON.parse(bytes.subarray(20,20+len)),bin:bytes.subarray(28+len)};}
function imageBytes(m,i){const v=m.json.bufferViews[m.json.images[i].bufferView];return m.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}
function colors(m){return [...new Set(m.json.materials.flatMap(mat=>{const t=mat.pbrMetallicRoughness?.baseColorTexture;return t?[sha(imageBytes(m,m.json.textures[t.index].source))]:[];}))].sort();}
function geometry(m){
 const j=m.json,triangles=[];let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 const get=(id,index)=>{const a=j.accessors[id],v=j.bufferViews[a.bufferView],size={5126:4,5125:4,5123:2,5121:1}[a.componentType],n=a.type==='VEC3'?3:1,offset=(v.byteOffset||0)+(a.byteOffset||0)+index*(v.byteStride||size*n);return Array.from({length:n},(_,k)=>a.componentType===5126?m.bin.readFloatLE(offset+k*size):size===4?m.bin.readUInt32LE(offset+k*size):size===2?m.bin.readUInt16LE(offset+k*size):m.bin[offset+k]);};
 for(const mesh of j.meshes)for(const p of mesh.primitives){
  const n=j.accessors[p.indices].count;for(let i=0;i<n;i+=3){const t=[];for(let k=0;k<3;k++){const pos=get(p.attributes.POSITION,get(p.indices,i+k)[0]);for(let c=0;c<3;c++){min[c]=Math.min(min[c],pos[c]);max[c]=Math.max(max[c],pos[c]);}t.push(pos.map(v=>Math.round(v*1e6)).join(','));}triangles.push(t.sort().join(';'));}
 }
 return {hash:sha(triangles.sort().join('|')),triangles:triangles.length,min,size:max.map((v,i)=>v-min[i])};
}
const report=[];
for(const [folder,newName,expected] of [['cube-210030','cube-v9',[.8,.71,.8]]]){
 const bytes=await fs.readFile(`public/models/${folder}/${newName}.glb`),m=read(bytes);
 const g=geometry(m);assert.ok(g.triangles<60000);assert.ok(m.json.images.every(im=>im.bufferView!==undefined));
 assert.ok(g.size.every((v,i)=>Math.abs(v-expected[i])<.001));assert.ok(Math.abs(g.min[1])<.001);
 const validation=await validateBytes(new Uint8Array(bytes),{maxIssues:100});assert.equal(validation.issues.numErrors,0);assert.equal(validation.issues.numWarnings,0);
 assert.ok(bytes.length<3000000);
 assert.deepEqual(colors(m),[sha(await fs.readFile(`assets/${folder}/textures/v9-original-photo-atlas.jpg`))]);
 report.push({folder,bytes:bytes.length,sha256:sha(bytes),...g,basecolor_sha256:colors(m),original_photo_texture:true,embedded_textures:true,validation});
}
await fs.writeFile('assets/cube-210030/qa/v9/glb-validation.json',JSON.stringify(report,null,2)+'\n');console.log(report.map(({folder,bytes,triangles,size,validation})=>({folder,bytes,triangles,size,errors:validation.issues.numErrors,warnings:validation.issues.numWarnings})));
