/** Repack the approved v4, preserving every geometry buffer and UV coordinate. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const base = 'assets/cube-210030';
assert.equal(JSON.parse(await readFile('node_modules/@google/model-viewer/package.json', 'utf8')).version, '4.2.0', 'Use a new vendor URL when upgrading the runtime');
const input = await readFile('public/models/cube-210030/cube-v4.glb');
const jsonLength = input.readUInt32LE(12);
const model = JSON.parse(input.subarray(20, 20 + jsonLength));
const binary = input.subarray(28 + jsonLength);
const image = model.images.find(im => im.name === 'v4-original-panel-atlas');
const view = model.bufferViews[image.bufferView];
const original = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
const compressed = await sharp(original).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
await writeFile(`${base}/textures/v5-original-panel-atlas.jpg`, compressed);
const rawBefore = await sharp(original).removeAlpha().raw().toBuffer();
const rawAfter = await sharp(compressed).removeAlpha().raw().toBuffer();
assert.equal(rawBefore.length, rawAfter.length);
let squared = 0, absolute = 0;
for (let i = 0; i < rawBefore.length; i++) {
  const d = rawBefore[i] - rawAfter[i]; squared += d * d; absolute += Math.abs(d);
}
const psnr = 10 * Math.log10(255 ** 2 / (squared / rawBefore.length));
assert.ok(psnr > 40, `Texture quality gate: ${psnr} dB`);
const pieces = []; let offset = 0;
for (const [index, v] of model.bufferViews.entries()) {
  const bytes = index === image.bufferView ? compressed : binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  v.byteOffset = offset; v.byteLength = bytes.length;
  pieces.push(bytes); offset += bytes.length;
  const pad = (4 - offset % 4) % 4; pieces.push(Buffer.alloc(pad)); offset += pad;
}
image.mimeType = 'image/jpeg';
model.buffers[0].byteLength = offset;
const jsonBytes = Buffer.from(JSON.stringify(model));
const json = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 32)]);
const bin = Buffer.concat(pieces);
const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + bin.length, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
const output = Buffer.concat([header, json, binHeader, bin]);
await writeFile('public/models/cube-210030/cube-v5.glb', output);
await mkdir('public/vendor/model-viewer/4.2.0', { recursive: true });
await copyFile('node_modules/@google/model-viewer/dist/model-viewer.min.js', 'public/vendor/model-viewer/4.2.0/model-viewer.min.js');
await copyFile('node_modules/@google/model-viewer/LICENSE', 'public/vendor/model-viewer/4.2.0/LICENSE');
const report = { originalBytes: input.length, optimizedBytes: output.length, reductionPercent: 100 * (1 - output.length / input.length), texture: { originalBytes: original.length, optimizedBytes: compressed.length, psnrDb: psnr, meanAbsoluteRgbDifferenceOf255: absolute / rawBefore.length, resolution: '2048x2048', quality: 94, chroma: '4:4:4' }, geometry: 'Every non-image buffer copied byte-for-byte; UVs and triangles unchanged' };
await mkdir(`${base}/qa/v5`, { recursive: true });
await writeFile(`${base}/qa/v5/optimization.json`, JSON.stringify(report, null, 2));
console.log(report);
