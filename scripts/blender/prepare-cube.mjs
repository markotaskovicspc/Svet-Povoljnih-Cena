import sharp from 'sharp';
import { copyFile } from 'node:fs/promises';
for (const name of ['poster','front','rear','side','top']) {
  await sharp(`assets/cube-210030/renders/v4-${name}.png`).webp({quality:90}).toFile(`public/models/cube-210030/${name}-v4.webp`);
}
await copyFile('assets/cube-210030/references/01.webp','public/models/cube-210030/original.webp');
console.log('Prepared five model previews and original comparison image.');
