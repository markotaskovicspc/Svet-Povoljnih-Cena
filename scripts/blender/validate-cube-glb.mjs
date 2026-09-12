import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateBytes } from 'gltf-validator';
import assert from 'node:assert/strict';
const path='public/models/cube-210030/cube-v5.glb';
const bytes=await readFile(path);
const validation=await validateBytes(new Uint8Array(bytes),{uri:path,maxIssues:100});
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],triangles=0;
for(const mesh of json.meshes) for(const primitive of mesh.primitives){
 const acc=json.accessors[primitive.attributes.POSITION];
 for(let i=0;i<3;i++){min[i]=Math.min(min[i],acc.min[i]);max[i]=Math.max(max[i],acc.max[i]);}
 triangles+=json.accessors[primitive.indices].count/3;
 assert.ok(primitive.attributes.TEXCOORD_0!==undefined || mesh.name.includes('stitched'));
}
const size=max.map((n,i)=>n-min[i]);
assert.ok(size.every((n,i)=>Math.abs(n-[.8,.71,.8][i])<.001));assert.ok(Math.abs(min[1])<.001);
assert.ok(json.images.length>=3 && json.images.every(im=>im.bufferView!==undefined && ['image/png','image/jpeg'].includes(im.mimeType)));
assert.ok(triangles<60000 && bytes.length<10*1024*1024);
assert.equal(validation.issues.numErrors,0);
const report={bytes:bytes.length,triangles,size_m:size,min_m:min,textures:json.images.map(im=>im.name),sha256:createHash('sha256').update(bytes).digest('hex'),validation};
await writeFile('assets/cube-210030/glb-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({bytes:report.bytes,triangles,size_m:size,errors:validation.issues.numErrors,warnings:validation.issues.numWarnings}));
