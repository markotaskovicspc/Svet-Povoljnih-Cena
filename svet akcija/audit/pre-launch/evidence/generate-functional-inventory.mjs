import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const repo = "/Users/luka/svet povoljnih cena";
const audit = path.join(repo, "svet akcija/audit/pre-launch");
const appRoot = path.join(repo, "src/app");
const sourceRoots = [appRoot, path.join(repo, "src/components")];
const rows = [];

async function filesUnder(root) {
  const out = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(absolute));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(absolute);
  }
  return out.sort();
}

function relative(file) {
  return path.relative(repo, file).replaceAll(path.sep, "/");
}

function routeFor(file, suffix) {
  let value = relative(file).replace(/^src\/app\//, "").replace(new RegExp(`/${suffix}\\.(?:tsx?|jsx?)$`), "");
  value = value.split("/").filter((part) => !/^\(.+\)$/.test(part) && !part.startsWith("@")).join("/");
  return `/${value}`.replace(/\/$/, "") || "/";
}

function moduleFor(routeOrFile) {
  const value = routeOrFile.toLowerCase();
  if (value.includes("/admin/erp")) return "Admin ERP";
  if (value.includes("/admin")) return "Admin/CMS";
  if (value.includes("checkout") || value.includes("cart") || value.includes("korpa")) return "Checkout i korpa";
  if (value.includes("nalog") || value.includes("account") || value.includes("auth")) return "Nalog i autentikacija";
  if (value.includes("newsletter")) return "Newsletter";
  if (value.includes("reclamation") || value.includes("reklamacij")) return "Reklamacije";
  if (value.includes("cron") || value.includes("webhook")) return "Pozadinski poslovi/webhook";
  if (value.includes("fiscal")) return "Fiskalizacija";
  if (value.includes("rabalux") || value.includes("supplier")) return "Dobavljači";
  if (value.includes("shipment") || value.includes("mygls") || value.includes("x-express")) return "Dostava";
  if (value.includes("payment") || value.includes("ips") || value.includes("raiffeisen")) return "Plaćanje";
  if (value.includes("product") || value.includes("pretraga") || value.includes("kategor")) return "Katalog i pretraga";
  return "Javni storefront";
}

function csv(value) {
  const text = String(value ?? "").replaceAll(/\s+/g, " ").trim();
  return `"${text.replaceAll('"', '""')}"`;
}

function pageEvidence(route) {
  if (route === "/") return "Produkcioni desktop/mobile browser; screenshot; build";
  if (route === "/korpa") return "Produkcioni desktop/mobile browser; cart persistence; screenshot; build";
  if (route.startsWith("/checkout")) return "Produkcioni desktop/mobile browser do završnog pregleda bez submit-a; screenshot; build";
  if (route.startsWith("/p/")) return "Produkcioni PDP browser za RAB-79196; screenshot; build";
  if (route === "/pretraga") return "Produkcioni browser upiti SMD/SMD-LED/SKU; screenshot; build";
  if (route === "/admin") return "Postojeća autentifikovana SUPER sesija prikazala dashboard; anonimni curl 307; build";
  if (route === "/nalog" || route === "/nalog/prijava") return "Anonimni redirect za zaštićeni nalog + browser login forma; build/unit";
  return "Next build route manifest + statička inspekcija; nema bezbednog produkcionog E2E dokaza";
}

let pageNo = 0;
let apiNo = 0;
let ctlNo = 0;
const allFiles = (await Promise.all(sourceRoots.map(filesUnder))).flat();
const appFiles = await filesUnder(appRoot);

for (const file of appFiles.filter((item) => /\/page\.(tsx?|jsx?)$/.test(item))) {
  const route = routeFor(file, "page");
  const directlyTested = route === "/" || route === "/korpa" || route === "/pretraga" || route === "/admin" || route.startsWith("/checkout") || route.startsWith("/p/") || route === "/nalog" || route === "/nalog/prijava";
  rows.push({
    id: `PAGE-${String(++pageNo).padStart(3, "0")}`,
    module: moduleFor(route), type: "PAGE_ROUTE", location: route,
    action: "Otvaranje i osnovno renderovanje stranice",
    expected: "Ispravan sadržaj, navigacija, dozvole i stanje bez fatalne greške",
    source: relative(file), prerequisites: route.startsWith("/admin") ? "Admin sesija i odgovarajuća rola" : route.startsWith("/nalog/") ? "Korisnička sesija za privatne delove" : "Nema",
    status: directlyTested ? "PASS" : "PARTIAL",
    severity: route.startsWith("/checkout") || route.startsWith("/admin/erp") ? "P1" : "P2",
    evidence: pageEvidence(route),
    notes: directlyTested ? "Direktan ili route-protection dokaz postoji; pojedinačne mutacije nisu obuhvaćene ovim redom." : "Route postoji i build prolazi, ali nema potpunog browser/persistence/provider dokaza.",
    recommended: "Desktop + mobile E2E sa realnim prerequisites i proverom stanja nakon refresh-a",
  });
}

for (const file of appFiles.filter((item) => /\/route\.(tsx?|jsx?)$/.test(item))) {
  const route = routeFor(file, "route");
  const source = await fs.readFile(file, "utf8");
  const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map((m) => m[1]);
  for (const method of methods.length ? methods : ["HANDLER"]) {
    const readOnly = ["GET", "HEAD", "OPTIONS"].includes(method);
    const pass = route === "/api/health" || (readOnly && ["/api/products", "/api/search"].includes(route));
    rows.push({
      id: `API-${String(++apiNo).padStart(3, "0")}`,
      module: moduleFor(route), type: "API_HANDLER", location: route,
      action: `${method} ${route}`,
      expected: "Validacija ulaza, autorizacija, stabilan ugovor odgovora i kontrolisana greška",
      source: relative(file),
      prerequisites: route.includes("/admin/") ? "Admin sesija/rola" : route.includes("/cron/") ? "Cron tajna" : method === "GET" ? "Zavisni podaci po potrebi" : "Izolovana QA baza/provider sandbox",
      status: pass ? "PASS" : readOnly ? "PARTIAL" : "BLOCKED",
      severity: route.includes("checkout") || route.includes("payment") || route.includes("fiscal") || route.includes("admin/erp") ? "P1" : "P2",
      evidence: pass ? "Produkcioni HTTP/browser zahtev + build/unit" : readOnly ? "Build/unit/statička inspekcija; bez kompletnog ugovornog E2E" : "Mutacija nije pokrenuta protiv produkcije; nema izolovanog E2E_DATABASE_URL/provider sandbox acceptance",
      notes: readOnly ? "Handler je inventarisan; status ne podrazumeva sve varijante parametara." : "BLOCKED je nameran safety rezultat, ne tvrdnja da handler ne radi.",
      recommended: readOnly ? "Contract test za success/empty/error/auth varijante" : "Write-and-cleanup E2E na izolovanoj QA bazi sa idempotency i audit proverom",
    });
  }
}

const controlPattern = /^(button|input|select|textarea|form|a|Link|.*Button|.*Form|.*Input|.*Select|.*Textarea|.*Checkbox|.*Switch|.*Toggle|.*Upload|.*Dropzone|.*Picker|.*Combobox|.*Menu|.*Dialog|.*Tabs?|.*Action)$/i;

function attrText(node, sf, names) {
  const attributes = node.attributes?.properties ?? [];
  for (const attr of attributes) {
    if (!ts.isJsxAttribute(attr) || !names.includes(attr.name.text)) continue;
    if (!attr.initializer) return attr.name.text;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
    if (ts.isJsxExpression(attr.initializer)) return attr.initializer.expression?.getText(sf) ?? attr.name.text;
  }
  return "";
}

function directText(parent) {
  if (!ts.isJsxElement(parent)) return "";
  return parent.children.filter(ts.isJsxText).map((child) => child.text).join(" ").replaceAll(/\s+/g, " ").trim();
}

for (const file of allFiles.filter((item) => /\.(tsx|jsx)$/.test(item))) {
  const source = await fs.readFile(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  function visit(node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const tag = opening.tagName.getText(sf);
      if (controlPattern.test(tag)) {
        const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1;
        const attrs = attrText(opening, sf, ["aria-label", "name", "type", "href", "placeholder", "title", "action", "onClick"]);
        const label = directText(node) || attrs || `${tag} bez statičkog labela`;
        const rel = relative(file);
        const critical = /checkout|admin|payment|fiscal|shipment|invoice|order|inventory|stock/i.test(rel);
        const browserEvidence = /components\/(checkout|cart)|product-card|identity-step/i.test(rel);
        rows.push({
          id: `CTL-${String(++ctlNo).padStart(4, "0")}`,
          module: moduleFor(rel), type: "UI_CONTROL", location: `${rel}:${line}`,
          action: `${tag}: ${label.slice(0, 180)}`,
          expected: tag.toLowerCase().includes("form") ? "Validacija, submit samo jednom, jasna success/error povratna informacija" : "Kontrola je dostupna tastaturom, izvršava akciju i prikazuje tačno stanje",
          source: rel, prerequisites: critical ? "Odgovarajuće stanje/sesija; izolovana QA baza za mutacije" : "Stranica koja renderuje komponentu",
          status: browserEvidence ? "PARTIAL" : "PARTIAL",
          severity: critical ? "P1" : "P2",
          evidence: browserEvidence ? "Produkcioni browser dokaz za reprezentativan tok + build; nisu sve grane kontrole izvršene" : "Statička kontrola inventarisana + build; direktan događaj/persistence nije zasebno dokazan",
          notes: "Jedan red predstavlja jednu statičku JSX definiciju; runtime mapiranja mogu proizvesti više instanci.",
          recommended: critical ? "E2E: klik/tastatura, validacija, refresh/persistence, authorization i rollback" : "Browser interaction + keyboard/focus + error state",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const headers = ["ID", "Modul", "Tip", "Ruta ili fajl", "Akcija/kontrola", "Očekivani rezultat", "Izvor implementacije", "Preduslovi", "Status", "Prioritet", "Dokaz", "Napomena", "Preporučeni test"];
const lines = [headers.map(csv).join(",")];
for (const row of rows) lines.push([row.id,row.module,row.type,row.location,row.action,row.expected,row.source,row.prerequisites,row.status,row.severity,row.evidence,row.notes,row.recommended].map(csv).join(","));
await fs.writeFile(path.join(audit, "02_FUNCTIONAL_INVENTORY.csv"), `${lines.join("\n")}\n`);

const stats = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  pages: pageNo,
  apiHandlers: apiNo,
  controls: ctlNo,
  byStatus: Object.fromEntries([...new Set(rows.map((row) => row.status))].sort().map((status) => [status, rows.filter((row) => row.status === status).length])),
  byModule: Object.fromEntries([...new Set(rows.map((row) => row.module))].sort().map((module) => [module, rows.filter((row) => row.module === module).length])),
};
await fs.writeFile(path.join(audit, "evidence/functional-inventory-stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
console.log(JSON.stringify(stats, null, 2));
