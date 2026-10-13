import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({admin:vi.fn(),note:vi.fn(),pdf:vi.fn()}));
vi.mock("@/lib/admin",()=>({requireAdminAction:mocks.admin}));
vi.mock("@/lib/admin/dispatch-note-print.server",()=>({getDispatchNotePrintData:mocks.note,buildDispatchNotePdf:mocks.pdf}));
import {GET} from "@/app/api/admin/dispatch-notes/[id]/pdf/route";
beforeEach(()=>{vi.clearAllMocks();mocks.admin.mockResolvedValue({role:"OPS"});mocks.note.mockResolvedValue({number:"13/26"});mocks.pdf.mockResolvedValue(Buffer.from("%PDF-preview"));});
it("awaits the PDF renderer and returns a private document attachment",async()=>{
 const result=await GET(new Request("https://example.test"),{params:Promise.resolve({id:"note"})});
 expect(await result.text()).toBe("%PDF-preview");
 expect(result.headers.get("content-disposition")).toContain('otpremnica-13-26.pdf');
 expect(result.headers.get("cache-control")).toBe("private, no-store");
 expect(mocks.admin).toHaveBeenCalledWith(["OPS"]);
});
it("does not build a PDF for a missing or unauthorized dispatch note",async()=>{
 mocks.note.mockResolvedValueOnce(null);
 expect((await GET(new Request("https://example.test"),{params:Promise.resolve({id:"missing"})})).status).toBe(404);
 expect(mocks.pdf).not.toHaveBeenCalled();
 mocks.admin.mockRejectedValueOnce(new Error("Forbidden"));
 await expect(GET(new Request("https://example.test"),{params:Promise.resolve({id:"note"})})).rejects.toThrow("Forbidden");
 expect(mocks.note).toHaveBeenCalledOnce();
});
