import { ReturnsWorkspace } from "@/components/admin/returns-workspace";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const metadata = { title: "Povrati za prijem · Picking", robots: { index: false, follow: false } };
export default async function ReturnsPage({ searchParams }: { searchParams?: Promise<{ view?: string; q?: string; evidence?: string; camera?: string; warehouse?: string }> } = {}) {
  return ReturnsWorkspace({ searchParams });
}
