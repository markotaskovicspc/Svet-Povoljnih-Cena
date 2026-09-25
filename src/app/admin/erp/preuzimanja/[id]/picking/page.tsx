import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { getPickingSession } from "@/lib/admin/picking.server";
import { PageHeader } from "@/components/admin/page-header";
import { DigitalPicking } from "@/components/admin/digital-picking";
export const dynamic = "force-dynamic";
export default async function DigitalPickingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const session = await getPickingSession(id);
  return <><PageHeader title={`Picking · ${session.number}`} description="Jedan obilazak, zbirno po artiklu i poziciji. Raspodela po porudžbinama ostaje vidljiva." actions={<Link href={`/admin/erp/preuzimanja/${id}`} className="rounded border px-4 py-2">Nalog i pakovanje</Link>} /><DigitalPicking key={`${session.planHash}:${session.events[0]?.id ?? "empty"}`} initial={session} /></>;
}
