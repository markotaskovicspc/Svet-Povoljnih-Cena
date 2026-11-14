import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Short link from Viber messages: /d/<order>/<token> → documents page. */
export default async function ShortOrderDocumentsLink({
  params,
}: {
  params: Promise<{ order: string; t: string }>;
}) {
  const { order, t } = await params;
  redirect(`/porudzbina/dokumenti?order=${encodeURIComponent(order)}&t=${encodeURIComponent(t)}`);
}
