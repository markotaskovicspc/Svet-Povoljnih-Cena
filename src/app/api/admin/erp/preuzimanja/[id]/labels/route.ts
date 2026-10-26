import { requireAdminAction } from "@/lib/admin";
import { buildPickupLabelsResponse } from "@/lib/admin/pickup-labels.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await requireAdminAction(["OPS", "WAREHOUSE"], ["/admin/erp/preuzimanja","/admin/magacin"]);
  return buildPickupLabelsResponse(request, (await context.params).id);
}
