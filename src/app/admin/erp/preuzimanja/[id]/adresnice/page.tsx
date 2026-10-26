import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function PickupLabelsPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["OPS"], "/admin/erp/preuzimanja");
  const { id } = await params;
  redirect(`/api/admin/erp/preuzimanja/${encodeURIComponent(id)}/labels?sort=name`);
}
