import sharp from 'sharp';
import fs from 'node:fs/promises';
const root=process.cwd();const reports=[];
for(const [folder,v] of [['cube-210030','v7'],['x-desk-210027','v3']]){
 const src=`${root}/assets/${folder}/renders/${v}-realism-poster.png`;
 const a=await sharp(src).flatten({background:'#fff'}).raw().toBuffer();
 for(const fmt of ['glb','usdz']){const b=await sharp(`${root}/assets/${folder}/renders/${v}-realism-${fmt}-roundtrip.png`).flatten({background:'#fff'}).raw().toBuffer();let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);reports.push({folder,format:fmt,meanAbsoluteRgbDifferenceOf255:sum/a.length});}
 const tiles=[];
 for(const p of [`${root}/assets/${folder}/references/01.webp`,src,`${root}/assets/${folder}/renders/${v}-realism-detail.png`])tiles.push(await sharp(p).flatten({background:'#fff'}).resize(600,600,{fit:'contain',background:'#fff'}).png().toBuffer());
 await sharp({create:{width:1800,height:650,channels:3,background:'#fff'}}).composite(tiles.map((input,i)=>({input,left:i*600,top:50}))).webp({quality:90}).toFile(`${root}/assets/material-library/realism-v1/${folder}-comparison.webp`);
}
await fs.writeFile(`${root}/assets/material-library/realism-v1/roundtrip-comparison.json`,JSON.stringify(reports,null,2));console.log(reports);
