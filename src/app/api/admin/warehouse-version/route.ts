import { requireAdminAction } from "@/lib/admin";
import { warehouseRelease } from "@/lib/admin/warehouse-release.server";

export const dynamic = "force-dynamic";
export async function GET() {
  await requireAdminAction(["OPS", "WAREHOUSE"], "/admin/magacin");
  return Response.json({ release: warehouseRelease }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
