import test from 'node:test';
import assert from 'node:assert/strict';
import {metaSendTarget} from '../src/meta-send-target.mjs';
test('Instagram Facebook Login sends through the linked Page with the same token',()=>{
 const ig={channel:'instagram',login:'facebook',id:'123',token:'same'};
 assert.deepEqual(metaSendTarget(ig,[ig,{channel:'facebook',id:'456',token:'same'}]),{host:'graph.facebook.com',id:'456'});
 assert.throws(()=>metaSendTarget(ig,[{channel:'facebook',id:'999',token:'different'}]),/LINKED_PAGE_REQUIRED/);
});
test('explicit Page mapping and Instagram Login retain separate identities',()=>{
 assert.deepEqual(metaSendTarget({channel:'instagram',login:'facebook',id:'123',pageId:'456'},[]),{host:'graph.facebook.com',id:'456'});
 assert.deepEqual(metaSendTarget({channel:'instagram',login:'instagram',id:'123'},[]),{host:'graph.instagram.com',id:'123'});
 assert.deepEqual(metaSendTarget({channel:'facebook',login:'facebook',id:'456'},[]),{host:'graph.facebook.com',id:'456'});
});
