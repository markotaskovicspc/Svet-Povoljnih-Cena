/** Upload only reviewed public delivery assets; never overwrite a versioned object. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && key && !key.startsWith('GET_FROM_'), 'Storage credentials are required');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = 'product-models';
const types = ['model/gltf-binary', 'model/vnd.usdz+zip', 'image/webp'];
const { data: buckets, error: listError } = await client.storage.listBuckets();
if (listError) throw listError;
const existing = buckets.find(item => item.id === bucket);
if (!existing) {
  const { error } = await client.storage.createBucket(bucket, { public: true, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: types });
  if (error) throw error;
} else {
  assert.equal(existing.public, true, 'Refusing to change an existing private bucket');
}
const assets = [
  ['glbUrl', 'cube-v9.glb', types[0]],
  ['usdzUrl', 'cube-v9.usdz', types[1]],
  ['posterUrl', 'poster-v9.webp', types[2]],
];
const manifest = {}, verified = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [field, filename, contentType] of assets) {
  const object = `cube-210030/${filename}`;
  const bytes = await readFile(`public/models/${object}`);
  const publicUrl = client.storage.from(bucket).getPublicUrl(object).data.publicUrl;
  const previous = await fetch(publicUrl);
  let action = 'already-identical';
  if (previous.ok) {
    assert.equal(sha(Buffer.from(await previous.arrayBuffer())), sha(bytes), `Immutable object differs: ${object}; use a new version`);
  } else {
    const { error } = await client.storage.from(bucket).upload(object, bytes, { contentType, cacheControl: '31536000', upsert: false });
    if (error) throw error;
    action = 'uploaded';
  }
  const response = await fetch(publicUrl);
  assert.ok(response.ok, `Public download failed for ${object}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.equal(sha(downloaded), sha(bytes));
  assert.equal(response.headers.get('content-type')?.split(';')[0], contentType);
  manifest[field] = publicUrl;
  verified.push({ object, publicUrl, action, bytes: bytes.length, sha256: sha(bytes), mime: response.headers.get('content-type'), cache: response.headers.get('cache-control'), cors: response.headers.get('access-control-allow-origin') });
}
await writeFile('src/lib/product-ar-storage.json', JSON.stringify({ ...JSON.parse(await readFile('src/lib/product-ar-storage.json', 'utf8')), '100010-6b45ec': manifest }, null, 2) + '\n');
await mkdir('assets/cube-210030/qa/v9/storage', { recursive: true });
await writeFile('assets/cube-210030/qa/v9/storage/upload.json', JSON.stringify({ bucket, public: true, project: new URL(url).hostname, verified }, null, 2) + '\n');
console.log(JSON.stringify({ bucket, verified }, null, 2));
