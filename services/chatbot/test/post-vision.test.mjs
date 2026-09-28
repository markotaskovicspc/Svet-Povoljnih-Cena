import test from 'node:test';import assert from 'node:assert/strict';
import {postMedia,PostVisionReader,ambiguousVisualPrice} from '../src/post-vision.mjs';
import {CommentWorker} from '../src/comments.mjs';
const image=n=>`https://scontent.xx.fbcdn.net/${n}.jpg?signed=private`;
const visual={readable:true,objects:[{position:'gore levo',description:'crni radni sto',visibleName:'LOFT',visibleSku:''}],uncertainty:''};
test('generic price on a labelled collage asks which product, while explicit caption or position can resolve it',()=>{
 const post={text:'Ponuda za dom',visual:{images:[{objects:[{visibleName:'GOLDCORE pegla',visibleSku:'210005'},{visibleName:'URBAN stolica',visibleSku:'330001'}]}]}};
 assert(ambiguousVisualPrice(post,'Cena?'));assert(ambiguousVisualPrice(post,'Koja je cena, molim?'));
 assert(!ambiguousVisualPrice(post,'Koliko košta ova skroz gore?'));
 assert(!ambiguousVisualPrice({...post,text:'Pegla GOLDCORE je na akciji.'},'Cena?'));
 assert(ambiguousVisualPrice({...post,text:'GOLDCORE i URBAN na akciji.'},'Cena?'));
});
test('Facebook album and Instagram carousel preserve image order and bound vision work',()=>{
 const media=postMedia({full_picture:image(0),attachments:{data:[{subattachments:{data:[1,2,3,4].map(n=>({media:{image:{src:image(n)}},type:'photo'}))}}]}},'facebook');
 assert.deepEqual(media.images.map(x=>x.url),[image(1),image(2),image(3)]);assert.equal(media.omitted,1);
 const ig=postMedia({media_type:'CAROUSEL_ALBUM',children:{data:[{media_type:'IMAGE',media_url:image(1)},{media_type:'VIDEO',media_url:'https://cdninstagram.com/movie.mp4',thumbnail_url:image(2)}]}},'instagram');
 assert.equal(ig.images[1].preview,true);assert.equal(ig.images[1].url,image(2));
 assert.equal(postMedia({media_type:'VIDEO',media_url:'https://cdninstagram.com/movie.mp4'},'instagram').images.length,0);
 assert.equal(postMedia({full_picture:image(1)},'facebook').images.length,1);
});
test('vision cache contains descriptions only, expires and distinguishes changed media/model',async()=>{
 let now=1000,calls=0;const reader=new PostVisionReader({now:()=>now,ttl:100,maxEntries:2,load:async()=> 'data:image/png;base64,secretbytes',describe:async()=>{calls++;return visual;}});
 const media=postMedia({full_picture:image(1)},'facebook');const first=await reader.read(media,'model');
 assert.equal(first.images[0].objects[0].visibleName,'LOFT');await reader.read(media,'model');assert.equal(calls,1);
 now+=101;await reader.read(media,'model');assert.equal(calls,2);
 await reader.read(media,'other-model');assert.equal(calls,3);await reader.read(postMedia({full_picture:image(2)},'facebook'),'model');assert.equal(reader.cache.size,2);
 const saved=JSON.stringify([...reader.cache]);assert(!saved.includes('secretbytes'));assert(!saved.includes('signed=private'));assert(!saved.includes('fbcdn.net'));
});
test('unavailable or untrusted images preserve positions and never cause arbitrary fetch or a cached failure',async()=>{
 const loaded=[];let fail=true;const reader=new PostVisionReader({load:async url=>{loaded.push(url);if(fail)throw Error('expired');return 'image';},describe:async()=>visual});
 const media={images:[{imageNumber:1,url:'https://127.0.0.1/secret',preview:false},{imageNumber:2,url:image(2),preview:false}],omitted:1};
 assert.equal((await reader.read(media,'model')).failed,2);assert.deepEqual(loaded,[image(2)]);fail=false;
 const result=await reader.read(media,'model');assert.equal(result.failed,1);assert.equal(result.images[0].imageNumber,2);assert.equal(result.omitted,1);assert.equal(reader.cache.size,0);
});
test('comment worker fetches photo metadata and carries vision with the original caption without image URLs',async()=>{
 const reader=new PostVisionReader({load:async()=> 'image',describe:async()=>visual});
 const worker=new CommentWorker({graphVersion:'v26.0',model:'test',postVision:reader,fetchFn:async url=>{assert(decodeURIComponent(url).includes('full_picture'));return Response.json({message:'Nova ponuda',full_picture:image(1),permalink_url:'https://facebook.com/post/1'});}});
 const post=await worker.post({token:'test'},{channel:'facebook',postId:'123_456'});
 assert.equal(post.text,'Nova ponuda');assert.equal(post.visual.images[0].objects[0].visibleName,'LOFT');assert(!JSON.stringify(post).includes('signed=private'));
});
