import { requireAdminAction } from "@/lib/admin";

export async function GET() {
  await requireAdminAction(["OPS"]);
  return new Response("\uFEFFŠifra;Količina\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="stavke-porudzbenice.csv"', "Cache-Control": "no-store" },
  });
}
