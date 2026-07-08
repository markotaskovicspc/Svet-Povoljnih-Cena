import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mimeTypeForExtension } from "../../scripts/lib/media-variants.mjs";

const manifestPath = process.argv[2] || "outputs/svet-akcija-product-media-upload-manifest.json";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-media";
const onlyStoragePath = process.env.ONLY_STORAGE_PATH;
const onlyRelativeSourcePath = process.env.ONLY_RELATIVE_SOURCE_PATH;
const maxAttempts = Number.parseInt(process.env.UPLOAD_ATTEMPTS || "3", 10);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Example:");
  console.error("SUPABASE_URL=https://YOUR_PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=YOUR_KEY node outputs/upload-product-media-to-supabase.mjs");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = (manifest.entries || []).filter((entry) => {
  if (onlyStoragePath) {
    return entry.storagePath === onlyStoragePath;
  }
  if (onlyRelativeSourcePath) {
    return entry.relativeSourcePath === onlyRelativeSourcePath;
  }
  return true;
});

if (entries.length === 0) {
  console.error("No manifest entries matched the requested filter.");
  process.exit(1);
}

let uploaded = 0;
let failed = 0;

console.log(`Uploading ${entries.length} files to bucket "${bucket}"...`);

for (const entry of entries) {
  const ext = path.extname(entry.localSourcePath).toLowerCase();
  const contentType = mimeTypeForExtension(ext);
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${entry.storagePath}`;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const fileStat = await stat(entry.localSourcePath);
      const stream = createReadStream(entry.localSourcePath);

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": contentType,
        "content-length": String(fileStat.size),
        "x-upsert": "true",
      },
      body: stream,
      duplex: "half",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${body}`);
    }

    uploaded += 1;
    if (uploaded % 25 === 0 || uploaded === entries.length) {
      console.log(`Uploaded ${uploaded}/${entries.length}`);
    }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.error(`Retry ${attempt}/${maxAttempts} failed for ${entry.relativeSourcePath}: ${error.message}`);
      }
    }
  }

  if (lastError) {
    failed += 1;
    console.error(`FAILED ${entry.relativeSourcePath} -> ${entry.storagePath}`);
    console.error(lastError.message);
  }
}

console.log(`Done. Uploaded: ${uploaded}. Failed: ${failed}.`);
if (failed > 0) {
  process.exit(1);
}
