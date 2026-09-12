import sharp from 'sharp';
for (const [folder,version] of [['cube-210030','v6'],['x-desk-210027','v2']]) {
 await sharp(`assets/${folder}/renders/${version}-blendkit-glb-roundtrip.png`).flatten({background:'#ffffff'}).resize(960,960,{fit:'inside'}).webp({quality:83}).toFile(`public/models/${folder}/poster-${version}.webp`);
}
