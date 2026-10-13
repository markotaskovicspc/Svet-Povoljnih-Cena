import { ReturnsWorkspace } from "@/components/admin/returns-workspace";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const metadata = { title: "Magacin · Povrat", robots: { index: false, follow: false } };
export default async function WarehouseReturns({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; evidence?: string; camera?: string; warehouse?: string; received?: string }> }) {
  return ReturnsWorkspace({ searchParams, warehouseMode: true });
}
