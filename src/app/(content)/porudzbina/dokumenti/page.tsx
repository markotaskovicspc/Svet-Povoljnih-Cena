import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { listCustomerDocuments, verifyOrderDocumentsToken } from "@/lib/orders/customer-documents";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Dokumenta porudžbine",
  description: "Preuzmite dokumenta za svoju porudžbinu.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function OrderDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; t?: string }>;
}) {
  const params = await searchParams;
  const valid = verifyOrderDocumentsToken(params.order, params.t);
  const data = valid && params.order ? await listCustomerDocuments(params.order) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6 md:py-14">
      <div className="flex items-start gap-3 border-b border-border/70 pb-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted-bg text-walnut">
          <FileText className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-4xl text-ink-900">Dokumenta porudžbine</h1>
          {data ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-600">
              Porudžbina broj {data.orderNumber}. Dokumenta možete preuzeti u PDF formatu.
            </p>
          ) : null}
        </div>
      </div>

      <section className="mt-8 rounded-lg border border-border/70 bg-surface p-5">
        {data && params.t ? (
          <ul className="space-y-3">
            {data.documents.map((doc) => {
              const href = `/api/orders/${encodeURIComponent(data.orderNumber)}/dokumenti/${doc.kind}?t=${encodeURIComponent(params.t!)}${doc.index ? `&i=${doc.index}` : ""}`;
              return (
                <li key={`${doc.kind}-${doc.index ?? 0}`}>
                  <a href={href} className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-4 py-3 text-sm text-ink-900 hover:bg-muted-bg">
                    <span>{doc.label}</span>
                    <span className="text-walnut">Preuzmi PDF</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-600">
            Link nije važeći. Proverite da li ste otvorili ceo link iz poruke ili nas kontaktirajte.
          </p>
        )}
      </section>
    </main>
  );
}
