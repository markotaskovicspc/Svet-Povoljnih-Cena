import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const root='assets/cube-210030/qa/v5/';
const browser=await chromium.launch();const results=[];
for(const version of ['v4','v5','v4','v5']) {
 const context=await browser.newContext();const page=await context.newPage();
 await page.goto('http://127.0.0.1:3024/ar/100010-6b45ec?manual=1',{waitUntil:'domcontentloaded'});
 await page.addScriptTag({url:'/vendor/model-viewer/4.2.0/model-viewer.min.js',type:'module'});
 await page.waitForFunction(()=>!!customElements.get('model-viewer'));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:500000,uploadThroughput:125000});
 const result=await page.evaluate(async version=>{
  const v=document.createElement('model-viewer');v.style.cssText='width:600px;height:600px';v.setAttribute('loading','eager');v.setAttribute('reveal','auto');document.body.replaceChildren(v);
  const start=performance.now();await new Promise((resolve,reject)=>{v.addEventListener('load',resolve,{once:true});v.addEventListener('error',reject,{once:true});v.setAttribute('src',`/models/cube-210030/cube-${version}.glb`)});
  const resource=performance.getEntriesByType('resource').find(x=>x.name.endsWith(`cube-${version}.glb`));
  return {version,loadMs:performance.now()-start,transferSize:resource.transferSize,decodedBodySize:resource.decodedBodySize,duration:resource.duration};
 },version);results.push(result);console.log(result);await context.close();
}
await writeFile(root+'network-benchmark.json',JSON.stringify({environment:'Headless Chrome, local Next dev, cold contexts, 4 Mbps download, 150 ms latency; runtime preloaded equally for both models; model transfer and render only',results},null,2));
const context=await browser.newContext();const page=await context.newPage();await page.goto('http://127.0.0.1:3024/p/100010-6b45ec',{waitUntil:'domcontentloaded'});
for(const name of ['Samo nužni','Zatvori obaveštenje']){const b=page.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click()}
await page.getByRole('button',{name:'Otvori 3D pregled',exact:true}).waitFor({timeout:60000});const t=Date.now();await page.getByRole('button',{name:'Otvori 3D pregled',exact:true}).click();await page.waitForFunction(()=>document.querySelector('model-viewer')?.loaded,null,{timeout:60000});
const after={clickToLoadedMs:Date.now()-t,resources:await page.evaluate(()=>performance.getEntriesByType('resource').filter(x=>/model|three|\.glb|lit_|lit-html/.test(x.name)).map(x=>({url:x.name,duration:x.duration,transferSize:x.transferSize,decodedBodySize:x.decodedBodySize})))};await writeFile(root+'after.json',JSON.stringify(after,null,2));console.log(after);
await page.screenshot({path:root+'desktop-model.png'});await browser.close();
