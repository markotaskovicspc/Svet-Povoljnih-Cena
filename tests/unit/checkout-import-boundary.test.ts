import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps all eager checkout imports free of workers and optional providers", () => {
  const root = process.cwd();
  const pending = [["src/app/api/checkout/order/route.ts"]];
  const visited = new Set<string>();
  const violations: string[] = [];
  while (pending.length) {
    const chain = pending.pop()!;
    const file = chain.at(-1)!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isImportDeclaration(statement) && (statement.importClause?.isTypeOnly ||
        (statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
          !statement.importClause.name && statement.importClause.namedBindings.elements.every(e => e.isTypeOnly)))) continue;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const name = specifier.text;
      if (/^(playwright|@sparticuz|@aws-sdk\/client-ses|pdf-lib|exceljs)/.test(name)) {
        violations.push([...chain, name].join(" → "));
      }
      const base = name.startsWith("@/") ? name.replace("@/", "src/")
        : name.startsWith(".") ? path.join(path.dirname(file), name) : null;
      if (!base) continue;
      const resolved = [base + ".ts", base + ".tsx", base + "/index.ts"].find(p => existsSync(path.join(root, p)));
      if (!resolved) continue;
      if (/src\/lib\/(background-jobs|email\/|pdf\/|receipts\/|rabalux\/(fulfillment|documents)|payments\/ips|mygls\/(shipments|sync))/.test(resolved)) {
        violations.push([...chain, resolved].join(" → "));
      }
      pending.push([...chain, resolved]);
    }
  }
  expect(violations).toEqual([]);
});
