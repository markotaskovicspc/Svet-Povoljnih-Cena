import { beforeEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { parsePhoneImport } from "@/lib/messaging/contact-import";
const mocks = vi.hoisted(() => ({ query: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.query, viberAudienceQuery: { upsert: mocks.upsert } } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(async () => ({ id: "actor" })) }));
import { POST } from "@/app/api/admin/messaging-contact-import/route";
beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue([]); mocks.upsert.mockImplementation(async (v) => ({ id: v.create.id, name: v.create.name })); });
async function xlsx(rows: unknown[][]) {
 const wb = new ExcelJS.Workbook(); wb.addWorksheet("Kontakti").addRows(rows);
 return new File([await wb.xlsx.writeBuffer() as ArrayBuffer], "kontakti.xlsx");
}
it("reads real Excel cells, recovers numeric leading zero, deduplicates and rejects formulas", async () => {
 const f = await xlsx([["Kontakti za oktobar"], ["Ime", "Broj telefona"], ["Marko", 637725045], ["Duplikat", "+381 63 772-5045"], ["Ana", "0641234567"], ["Greška", "abc"], ["Formula", { formula: '"0637725045"', result: "0637725045" }]]);
 const p = await parsePhoneImport(f);
 expect(p.phoneColumn).toBe(1); expect(p.totalRows).toBe(5); expect(p.duplicates).toBe(1); expect(p.invalidRows).toEqual([6, 7]);
 expect(p.contacts).toEqual([{phone:"381637725045",name:"Marko"},{phone:"381641234567",name:"Ana"}]);
});
it("supports headerless phone lists and explicit column selection in CSV", async () => {
 const p = await parsePhoneImport(new File(["0637725045\n00381641234567\n"], "list.csv"));
 expect(p.contacts).toHaveLength(2); expect(p.totalRows).toBe(2);
 const c = await parsePhoneImport(new File(["Ime;Telefon;Drugi broj\nAna;0637725045;0651234567"], "list.csv"), 2);
 expect(c.contacts[0].phone).toBe("381651234567");
});
it("rejects old/invalid spreadsheets, oversize files, empty input, and invalid mapping", async () => {
 for (const f of [new File(["x"], "a.xls"),new File(["wrong"],"a.xlsx"),new File([],"a.csv"),new File(["x".repeat(4*1024*1024+1)],"a.csv")]) await expect(parsePhoneImport(f)).rejects.toThrow();
 await expect(parsePhoneImport(new File(["0637725045"], "a.csv"), -1)).rejects.toThrow();
});
async function request(file: File, mode="preview", extra: Record<string,string> = {}) {
 const body = new FormData(); body.set("file",file); body.set("channel","SMS"); body.set("mode",mode);
 for(const [k,v] of Object.entries(extra)) body.set(k,v);
 return POST(new Request("http://localhost/api/admin/messaging-contact-import",{method:"POST",body}));
}
it("previews without a write; saves a channel-specific immutable audience only after matching review", async () => {
 const f = await xlsx([["Telefon"],["0637725045"],["0641234567"],["loš"]]);
 mocks.query.mockResolvedValue([{phone:"0641234567"}]);
 const preview = await (await request(f)).json();
 expect(preview).toMatchObject({unique:2,blocked:1,eligible:1,invalid:1}); expect(mocks.upsert).not.toHaveBeenCalled();
 expect((await request(f,"commit",{digest:preview.digest,name:"Moja lista"})).status).toBe(400);
 expect((await request(f,"commit",{digest:"changed",confirmed:"true",name:"Moja lista"})).status).toBe(400);
 const args = {digest:preview.digest,confirmed:"true",name:"Moja lista"};
 const first = await (await request(f,"commit",args)).json();
 const second = await (await request(f,"commit",args)).json();
 expect(first.audience.id).toBe(second.audience.id);
 expect(mocks.upsert.mock.calls[0][0]).toMatchObject({update:{},create:{filter:{channel:"SMS",importSource:{actorId:"actor"},importedContacts:[{phone:"381637725045"},{phone:"381641234567"}]}}});
 expect(mocks.upsert.mock.calls[0][0].create.filter).not.toHaveProperty("consentEvidence");
});
