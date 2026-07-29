import { createServer } from "node:http";

const host = process.env.STORAGE_MOCK_HOST?.trim() || "127.0.0.1";
const requestedPort = Number(process.env.STORAGE_MOCK_PORT ?? "54321");
const port = Number.isInteger(requestedPort) && requestedPort > 0
  ? requestedPort
  : 54321;
const objects = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "GET" && pathname === "/health") {
      return json(response, 200, { ok: true, objects: objects.size });
    }

    const publicMatch = pathname.match(
      /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/,
    );
    if (request.method === "GET" && publicMatch) {
      const object = objects.get(objectId(publicMatch[1], publicMatch[2]));
      if (!object) return json(response, 404, { message: "Object not found" });
      response.writeHead(200, {
        "content-type": object.contentType,
        "content-length": object.body.length,
        "cache-control": "public, max-age=60",
      });
      return response.end(object.body);
    }

    const listMatch = pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
    if (request.method === "POST" && listMatch) {
      const input = await readJson(request);
      const prefix = cleanKey(input.prefix ?? "");
      const search = String(input.search ?? "");
      const limit = Math.max(1, Math.min(Number(input.limit) || 100, 1_000));
      const rows = [];
      for (const [id, object] of objects) {
        if (object.bucket !== listMatch[1]) continue;
        const separator = object.key.lastIndexOf("/");
        const folder = separator >= 0 ? object.key.slice(0, separator) : "";
        const name = separator >= 0 ? object.key.slice(separator + 1) : object.key;
        if (folder !== prefix || (search && !name.includes(search))) continue;
        rows.push({
          id,
          name,
          created_at: object.createdAt,
          updated_at: object.createdAt,
          last_accessed_at: object.createdAt,
          metadata: {
            mimetype: object.contentType,
            size: object.body.length,
          },
        });
        if (rows.length >= limit) break;
      }
      return json(response, 200, rows);
    }

    const bucketMatch = pathname.match(/^\/storage\/v1\/object\/([^/]+)(?:\/(.+))?$/);
    if (bucketMatch && request.method === "DELETE" && !bucketMatch[2]) {
      const input = await readJson(request);
      const prefixes = Array.isArray(input.prefixes) ? input.prefixes : [];
      const removed = [];
      for (const rawKey of prefixes) {
        const key = cleanKey(rawKey);
        const id = objectId(bucketMatch[1], key);
        if (!objects.delete(id)) continue;
        removed.push({ bucket_id: bucketMatch[1], name: key });
      }
      return json(response, 200, removed);
    }

    if (
      bucketMatch &&
      bucketMatch[2] &&
      (request.method === "POST" || request.method === "PUT")
    ) {
      const bucket = bucketMatch[1];
      const key = cleanKey(bucketMatch[2]);
      const id = objectId(bucket, key);
      const upsert = request.headers["x-upsert"] === "true";
      if (!upsert && objects.has(id)) {
        return json(response, 409, { message: "The resource already exists" });
      }
      const body = await readBody(request);
      objects.set(id, {
        bucket,
        key,
        body,
        contentType: String(request.headers["content-type"] ?? "application/octet-stream"),
        createdAt: new Date().toISOString(),
      });
      return json(response, 200, { Key: `${bucket}/${key}`, key });
    }

    return json(response, 404, { message: "Unsupported storage mock route" });
  } catch (error) {
    return json(response, 500, {
      message: error instanceof Error ? error.message : "Storage mock failure",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Supabase storage mock ready at http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function cleanKey(value) {
  return String(value).replace(/^\/+|\/+$/g, "");
}

function objectId(bucket, key) {
  return `${bucket}/${cleanKey(key)}`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJson(request) {
  const body = await readBody(request);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
}
