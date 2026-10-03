import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveVisualSelection} from '../src/visual-candidates.mjs';
const context=()=>({history:[],visualContext:{createdAt:Date.now(),images:[{imageNumber:1,objects:[{position:'levo',description:'siva stolica'},{position:'desno',description:'sto'}]}]}});
test('collage clarification is asked once and semantic follow-up reaches sales conversation',async()=>{
 const state=context(),choose=async()=>({intent:'clarify',imageNumber:null,objectNumber:null});
 assert.match(await resolveVisualSelection({state,event:{text:'ovu'},choose}),/siva stolica/);
 assert.equal(await resolveVisualSelection({state,event:{text:'4 sive stolice'},choose}),null);
});
test('category and colour can select a unique object without a spatial question',async()=>{
 const state=context();
 const result=await resolveVisualSelection({state,event:{text:'sivu stolicu'},choose:async c=>{assert.match(c.instruction,/kategoriju/);return {intent:'select',imageNumber:1,objectNumber:1};}});
 assert.equal(result,null);assert.deepEqual(state.visualContext.selection,{imageNumber:1,objectNumber:1});
});
test('selector timeout does not manufacture a repetitive customer question',async()=>{
 const state=context();
 assert.equal(await resolveVisualSelection({state,event:{text:'sto'},choose:async()=>{throw Error('timeout');}}),null);
 assert.equal(state.visualContext.clarificationAsked,undefined);
});
