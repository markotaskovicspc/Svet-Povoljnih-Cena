import {createHash} from 'node:crypto';
import {allowedImageUrl,loadMetaImage,describeImage,visualSchema} from './vision.mjs';

export const MAX_POST_IMAGES=3;
const normalize=text=>String(text??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export function ambiguousVisualPrice(post,text){
 // Generic price-only questions provide no selection among explicitly labelled products.
 const question=normalize(text).replace(/\b(molim|hvala)\b/g,'').replace(/\s+/g,' ').trim();
 if(!/^(?:(?:koja|kolika) je )?(?:cena|cijena)(?: za ovo)?$|^koliko(?: (?:kosta|je))?$/.test(question))return false;
 const labelled=new Map();for(const image of post.visual?.images??[])for(const object of image.objects??[]){const key=normalize(object.visibleSku||object.visibleName);if(key)labelled.set(key,object);}
 if(labelled.size<2)return false;
 const caption=normalize([post.text,...(post.attachments??[]).flatMap(x=>[x.title,x.description])].join(' '));
 const named=[...labelled.values()].filter(x=>(x.visibleSku&&caption.includes(normalize(x.visibleSku)))||normalize(x.visibleName).split(' ').filter(w=>w.length>3).some(w=>caption.split(' ').includes(w)));
 return named.length!==1;
}
export function postMedia(data,channel){
 const candidates=[];
 const add=(url,preview=false)=>{if(typeof url==='string'&&url&&!candidates.some(x=>x.url===url))candidates.push({url,preview});};
 if(channel==='facebook'){
  const visit=a=>{const children=a.subattachments?.data??[];if(children.length){for(const child of children.slice(0,25))visit(child);}else add(a.media?.image?.src,/video/i.test(a.type??''));};
  for(const a of (data.attachments?.data??[]).slice(0,25))visit(a);
  if(!candidates.length)add(data.full_picture);
 }else{
  const items=data.media_type==='CAROUSEL_ALBUM'?(data.children?.data??[]):[data];
  for(const item of items.slice(0,25)){if(item.media_type==='VIDEO')add(item.thumbnail_url,true);else if(item.media_type==='IMAGE')add(item.media_url);}
 }
 return {images:candidates.slice(0,MAX_POST_IMAGES).map((x,i)=>({...x,imageNumber:i+1})),omitted:Math.max(0,candidates.length-MAX_POST_IMAGES)};
}

export class PostVisionReader{
 constructor({load=loadMetaImage,describe=describeImage,now=Date.now,ttl=10*60*1000,maxEntries=100}={}){Object.assign(this,{load,describe,now,ttl,maxEntries});this.cache=new Map();}
 async read(media,model){
  if(!media.images.length)return {images:[],failed:0,omitted:media.omitted};
  const key=createHash('sha256').update(JSON.stringify({media,model})).digest('hex');
  const cached=this.cache.get(key);if(cached&&this.now()-cached.at<this.ttl)return cached.value;
  this.cache.delete(key);
  const analyses=await Promise.allSettled(media.images.map(async x=>{if(!allowedImageUrl(x.url))throw Error('POST_IMAGE_HOST_REJECTED');return {imageNumber:x.imageNumber,preview:x.preview,...visualSchema.parse(await this.describe({image:await this.load(x.url),model}))};}));
  const value={images:analyses.filter(x=>x.status==='fulfilled').map(x=>x.value),failed:analyses.filter(x=>x.status==='rejected').length,omitted:media.omitted};
  // Cache descriptions only, never image bytes or signed media URLs. Failed downloads can retry.
  if(!value.failed){this.cache.set(key,{at:this.now(),value});while(this.cache.size>this.maxEntries)this.cache.delete(this.cache.keys().next().value);}
  return value;
 }
}
