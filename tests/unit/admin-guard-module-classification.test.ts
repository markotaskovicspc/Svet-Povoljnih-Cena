import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { adminModuleForPage, permissionGroups } from "@/lib/admin/access-policy";

const root = process.cwd();
const knownModules = new Set([
  ...permissionGroups.flatMap(group => group.modules.map(module => module.key)),
  "/admin/erp", "/admin/erp/operativci", "/admin/erp/spcapp", "/admin/audit-log",
  "/admin/erp/integracije", "/admin/erp/admin-podesavanja",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.[jt]sx?$/.test(entry.name) ? [file] : [];
  });
}

type GuardSite = { file: string; line: number; name: string; module?: ts.Expression; source: ts.SourceFile };
const sites: GuardSite[] = [];
for (const file of [...sourceFiles(resolve(root, "src/app")), ...sourceFiles(resolve(root, "src/components/admin"))]) {
  const text = readFileSync(file, "utf8");
  if (!/requireAdmin|withAdmin/.test(text)) continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (["requireAdminAction", "requireAdmin", "withAdminState", "withAdmin"].includes(name)) {
        let permissionModule: ts.Expression | undefined;
        if (name === "requireAdminAction" || name === "requireAdmin") permissionModule = node.arguments[1];
        else {
          const meta = node.arguments[0];
          if (meta && ts.isObjectLiteralExpression(meta)) {
            const property = meta.properties.find(property => property.name?.getText(source) === "module");
            if (property && ts.isPropertyAssignment(property)) permissionModule = property.initializer;
          }
        }
        sites.push({ file: relative(root, file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, name, module: permissionModule, source });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

describe("explicit administrative module guard classification", () => {
  it("keeps every page/API/server-action guard classified instead of falling back to a role", () => {
    expect(sites.length).toBeGreaterThan(200);
    const missing = sites.filter(site => !site.module || site.module.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(site.module) && site.module.text === "undefined"));
    expect(missing.map(site => `${site.file}:${site.line} ${site.name}`)).toEqual([]);
  });

  it("uses catalog keys for every literal module, including intentional shared-module OR lists", () => {
    const unknown: string[] = [];
    for (const site of sites) {
      const inspect = (expression: ts.Expression) => {
        if (ts.isStringLiteralLike(expression) && !knownModules.has(adminModuleForPage(expression.text) ?? expression.text)) {
          unknown.push(`${site.file}:${site.line} ${expression.text}`);
        } else if (ts.isArrayLiteralExpression(expression)) {
          expression.elements.forEach(element => { if (ts.isExpression(element)) inspect(element); });
        }
      };
      if (site.module) inspect(site.module);
    }
    expect(unknown).toEqual([]);
  });

  it("binds every generic ERP guard to the actual route slug", () => {
    const generic = sites.filter(site => site.file.includes("/erp/[module]/"));
    expect(generic).toHaveLength(5);
    for (const site of generic) {
      expect(site.module && ts.isTemplateExpression(site.module), `${site.file}:${site.line}`).toBe(true);
      if (site.module && ts.isTemplateExpression(site.module)) {
        expect(site.module.head.text).toBe("/admin/erp/");
        expect(["module", "slug"]).toContain(site.module.templateSpans[0].expression.getText(site.source));
      }
    }
  });

  it("checks the command/module binding before invoking the generic dispatcher", () => {
    const source = readFileSync(resolve(root, "src/app/api/admin/erp/[module]/commands/route.ts"), "utf8");
    const binding = source.indexOf("if (!isErpCommandBoundToModule(module, action))");
    expect(binding).toBeGreaterThan(0);
    expect(binding).toBeLessThan(source.indexOf("await runCommand(module, action, ids"));
  });

  it("does not retain direct JWT-role authorization on the import or push escape hatches", () => {
    for (const file of ["src/app/api/admin/erp/order-import/route.ts", "src/app/api/admin/push/route.ts"]) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source, file).toContain("canAccessAdminModule(admin,");
      expect(source, file).not.toMatch(/isAuthorized\(admin\.role|canReceiveOrderPush\(admin\.role/);
    }
  });
});
