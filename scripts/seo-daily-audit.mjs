/** Read-only public SEO check. No credentials, database writes or external AI calls. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "https://www.svetpovoljnihcena.rs";
const dir = path.join(root, "tmp/seo-daily");
const checkedAt = new Date().toISOString();
const pause = () => new Promise(resolve => setTimeout(resolve, 500));
const readJson = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; } };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const plain = value => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3]]));
const facts = p => ({ sku:p.sku, slug:p.slug, name:p.name, shortDescription:p.shortDescription, description:p.description, colorPrimary:p.colorPrimary, dimensionsCm:p.dimensionsCm, attributes:p.attributes, materials:p.materials, pdpInfo:p.pdpInfo, attachments:p.attachments,
  variantFamily:p.variantFamily ? {id:p.variantFamily.id,code:p.variantFamily.code,selectedSku:p.variantFamily.selectedSku,options:p.variantFamily.options.map(v=>({sku:v.sku,slug:v.slug,name:v.name,label:v.label,colorPrimary:v.colorPrimary}))} : null });
async function request(url, options = {}) {
  if (new URL(url).origin !== base) throw new Error("Unexpected origin");
  await pause();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000), redirect: "manual" });
  return response;
}

await fs.mkdir(dir, { recursive: true });
const previous = await readJson(path.join(dir, "latest-complete.json"), null);
const lastAttempt = await readJson(path.join(dir, "latest.json"), null);
const worklist = await readJson(path.join(root, "docs/seo/catalog-worklist-2026-09-30.json"), []);
const result = { checkedAt, complete:false, errors:[], summary:{}, pages:[], products:[], newFindings:[], changedProducts:[] };
try {
  const sm = await request(base + "/sitemap.xml");
  if (!sm.ok) throw new Error(`Sitemap HTTP ${sm.status}`);
  const xml = await sm.text();
  if (!/<urlset\b/.test(xml)) throw new Error("Expected a URL sitemap; inspect sitemap index manually");
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([,block]) => ({
    url:block.match(/<loc>(.*?)<\/loc>/)?.[1]?.replace(/&amp;/g, "&"),
    lastModified:block.match(/<lastmod>(.*?)<\/lastmod>/)?.[1] ?? null,
  }));
  if (!entries.length || entries.length > 5000 || entries.some(e => !e.url || new URL(e.url).origin !== base)) throw new Error("Unexpected sitemap size or URL");
  const productUrls = new Set(entries.filter(e => new URL(e.url).pathname.startsWith("/p/")).map(e => e.url));
  if (previous?.summary?.publicProductUrls > 0 && productUrls.size === 0) throw new Error("Product sitemap became empty; keep the previous baseline and inspect availability");
  const known = new Map(worklist.map(p => [p.url, p.sku]));
  // Preserve successful discovery from incomplete runs, otherwise more than 20
  // new products would keep the rotating sample stuck on the same first batch.
  for (const p of [...previous?.products ?? [], ...lastAttempt?.products ?? []]) known.set(p.url, p.sku);
  const priorPages = new Map([...previous?.pages ?? [], ...lastAttempt?.pages ?? []].map(p => [p.url, p]));
  // All public product text is checked through the lookup API; rendered pages
  // rotate (20/day), with unknown products first. Report this coverage explicitly.
  const pageQueue = [...entries].sort((a,b) => {
    const unknownA = productUrls.has(a.url) && !known.has(a.url);
    const unknownB = productUrls.has(b.url) && !known.has(b.url);
    return Number(unknownB)-Number(unknownA) || String(priorPages.get(a.url)?.checkedAt ?? "").localeCompare(String(priorPages.get(b.url)?.checkedAt ?? ""));
  }).slice(0,20);
  const probes = ["/pretraga?q=stolica", "/svet-akcija/110082", "/k/radna-soba"];
  const pageResults = new Map(priorPages);
  for (const { url } of [...pageQueue, ...probes.map(p => ({url:base+p}))]) {
    try {
      const r = await request(url), html = await r.text();
      const tags = [...html.matchAll(/<(?:meta|link)\b[^>]*>/gi)].map(m => attrs(m[0]));
      const meta = name => tags.find(t => t.name?.toLowerCase() === name)?.content ?? "";
      const canonical = tags.find(t => t.rel === "canonical")?.href ?? "";
      const robots = [meta("robots"), r.headers.get("x-robots-tag") ?? ""].join(", ");
      const findings = [];
      const json = [];
      for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (attrs(script[1]).type !== "application/ld+json") continue;
        try { const j=JSON.parse(script[2]); json.push(...(Array.isArray(j)?j:j["@graph"]??[j])); }
        catch { findings.push("JSONLD_PARSE_ERROR"); }
      }
      const product = json.find(j => j["@type"] === "Product");
      if (product?.sku && productUrls.has(url)) known.set(url, String(product.sku));
      const inSitemap = entries.some(e => e.url === url);
      if (inSitemap && r.status !== 200) findings.push("SITEMAP_NON_200");
      if (inSitemap && /noindex/i.test(robots)) findings.push("SITEMAP_NOINDEX");
      if (r.status === 200 && !/noindex/i.test(robots)) {
        if (!canonical) findings.push("CANONICAL_MISSING");
        if (!meta("description")) findings.push("META_MISSING");
        if (productUrls.has(url) && !product) findings.push("PRODUCT_SCHEMA_MISSING");
      }
      if (url.includes("/pretraga?") && r.status === 200 && !/noindex/i.test(robots)) findings.push("SEARCH_INDEXABLE");
      const p = {url, checkedAt, status:r.status, location:r.headers.get("location"), canonical, robots, meta:meta("description"), findings};
      pageResults.set(url,p);
      const old = priorPages.get(url)?.findings ?? [];
      result.newFindings.push(...findings.filter(f => !old.includes(f)).map(f => ({url, issue:f})));
    } catch(e) { result.errors.push({url, error:e.message}); }
  }
  result.pages = [...pageResults.values()].filter(p => entries.some(e => e.url===p.url) || probes.some(x => base+x===p.url));
  const skus = [...new Set([...productUrls].map(url => known.get(url)).filter(Boolean))];
  const priorProducts = new Map((previous?.products ?? []).map(p => [p.sku,p]));
  for (let start=0; start<skus.length; start+=50) {
    const batch = skus.slice(start,start+50);
    try {
      const r = await request(base+"/api/products/lookup", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({skus:batch})});
      if (!r.ok) throw new Error(`Lookup HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data.products)) throw new Error("Unexpected lookup response");
      for (const sku of batch) if (!data.products.some(p => p.sku===sku)) result.errors.push({sku,error:"Listed product not returned by lookup"});
      for (const p of data.products) {
        const source = facts(p), sourceHash = hash(source), body = plain(p.description), findings=[];
        if (!body || /dopuniti opis|opis uskoro|lorem ipsum/i.test(body)) findings.push("DESCRIPTION_NEEDS_FACTS");
        if (/bezbedn|sigurnost|zdrav|povred|decu|antibakter|antialerg/i.test(body)) findings.push("SENSITIVE_CLAIM_REVIEW");
        const old = priorProducts.get(p.sku);
        const record = {sku:p.sku, url:base+"/p/"+p.slug, sourceHash, facts:source, findings};
        result.products.push(record);
        if (!old || old.sourceHash!==sourceHash) result.changedProducts.push({sku:p.sku,url:record.url,reason:old?"CONTENT_CHANGED":"FIRST_OBSERVATION"});
        result.newFindings.push(...findings.filter(f => !old?.findings?.includes(f)).map(issue => ({sku:p.sku,url:record.url,issue})));
      }
    } catch(e) { result.errors.push({skus:batch,error:e.message}); }
  }
  const unknown = [...productUrls].filter(url => !known.has(url));
  if (unknown.length) result.errors.push({error:"Unknown product SKUs remain; continue rotating page checks",urls:unknown});
  result.summary = {sitemapUrls:entries.length, publicProductUrls:productUrls.size, productFactsChecked:result.products.length, renderedPagesCheckedThisRun:pageQueue.length+probes.length, allRenderedPagesCheckedThisRun:pageQueue.length===entries.length, newFindings:result.newFindings.length, changedProducts:result.changedProducts.length};
  result.complete = result.errors.length === 0;
} catch(e) { result.errors.push({error:e.message}); }
await fs.writeFile(path.join(dir,"latest.json"),JSON.stringify(result,null,2));
await fs.writeFile(path.join(dir,checkedAt.replace(/[:.]/g,"-")+".json"),JSON.stringify(result,null,2));
if (result.complete) await fs.writeFile(path.join(dir,"latest-complete.json"),JSON.stringify(result,null,2));
console.log(JSON.stringify({complete:result.complete,...result.summary,errors:result.errors}));
if (!result.complete) process.exitCode=1;
