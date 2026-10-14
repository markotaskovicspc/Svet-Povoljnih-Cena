import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { getPickingSession } from "@/lib/admin/picking.server";
import { DigitalPicking } from "@/components/admin/digital-picking";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export default async function WarehousePickingDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminAction(["OPS", "WAREHOUSE"]);
  const { id } = await params;
  const session = await getPickingSession(id);
  return <main><div className="px-4 pt-4"><Link href="/admin/magacin" className="inline-flex min-h-11 items-center text-sm underline">← Svi nalozi</Link></div><DigitalPicking key={session.planHash} initial={session} warehouseMode /></main>;
}
