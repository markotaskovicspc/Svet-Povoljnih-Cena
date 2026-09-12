import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateBytes } from 'gltf-validator';
import assert from 'node:assert/strict';
const path='public/models/x-desk-210027/x-desk-v1.glb';
const bytes=await readFile(path);
const validation=await validateBytes(new Uint8Array(bytes),{uri:path,maxIssues:100});
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],triangles=0;
// Authoring script bakes every transform before export. Guard that assumption.
for(const node of json.nodes) {
 assert.ok(!node.matrix);
 assert.ok(!node.translation || node.translation.every(n=>Math.abs(n)<1e-7));
 assert.ok(!node.rotation || node.rotation.every((n,i)=>Math.abs(n-(i===3?1:0))<1e-7));
 assert.ok(!node.scale || node.scale.every(n=>Math.abs(n-1)<1e-7));
}
for(const mesh of json.meshes) for(const primitive of mesh.primitives){
 const acc=json.accessors[primitive.attributes.POSITION];
 for(let i=0;i<3;i++){min[i]=Math.min(min[i],acc.min[i]);max[i]=Math.max(max[i],acc.max[i]);}
 triangles+=json.accessors[primitive.indices].count/3;
}
const size=max.map((n,i)=>n-min[i]);
assert.ok(size.every((n,i)=>Math.abs(n-[.7,.74,.48][i])<.001));assert.ok(Math.abs(min[1])<.001);
assert.ok(json.images.length===1 && json.images.every(im=>im.bufferView!==undefined && im.mimeType==='image/jpeg'));
assert.ok(triangles<10000 && bytes.length<500000);
assert.equal(validation.issues.numErrors,0);
const report={bytes:bytes.length,triangles,size_m:size,min_m:min,textures:json.images,sha256:createHash('sha256').update(bytes).digest('hex'),validation};
await writeFile('assets/x-desk-210027/glb-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({bytes:report.bytes,triangles,size_m:size,errors:validation.issues.numErrors,warnings:validation.issues.numWarnings}));
