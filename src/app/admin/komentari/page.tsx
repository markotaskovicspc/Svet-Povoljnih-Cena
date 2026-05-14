import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Komentari kupaca",
  robots: { index: false, follow: false },
};

async function toggleReviewed(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT", "OPS"], action: "comment.toggleReviewed", entity: "Comment" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        const reviewed = formData.get("reviewed") === "true";
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.comment.update({ where: { id }, data: { reviewed: !reviewed } });
        revalidatePath("/admin/komentari");
        return { ok: true as const, entityId: id, diff: { reviewed: !reviewed } };
      },
  )(formData);
}

async function removeComment(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT", "OPS"], action: "comment.delete", entity: "Comment" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.comment.delete({ where: { id } });
        revalidatePath("/admin/komentari");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

export default async function CommentsPage() {
  await requireAdminAction(["CONTENT", "OPS"]);
  const comments = await db.comment.findMany({
    orderBy: [{ reviewed: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const pending = comments.filter((c) => !c.reviewed).length;

  return (
    <>
      <PageHeader
        title="Komentari kupaca"
        description={`${pending} novih · ${comments.length} ukupno`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Komentari" }]}
      />
      <div className="px-8 py-6">
        <Card>
          <DataTable
            columns={[
              { key: "date", label: "Datum" },
              { key: "name", label: "Ime" },
              { key: "email", label: "Email" },
              { key: "subject", label: "Tema" },
              { key: "body", label: "Poruka" },
              { key: "status", label: "Status" },
              { key: "actions", label: "" },
            ]}
            rows={comments.map((c) => ({
              id: c.id,
              cells: {
                date: c.createdAt.toLocaleString("sr-Latn-RS"),
                name: c.name,
                email: c.email,
                subject: c.subject ?? "—",
                body: <span className="line-clamp-3 max-w-md text-xs">{c.body}</span>,
                status: c.reviewed ? (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">
                    Pregledano
                  </span>
                ) : (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
                    Novo
                  </span>
                ),
                actions: (
                  <div className="flex gap-2">
                    <form action={toggleReviewed}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="reviewed" value={String(c.reviewed)} />
                      <SubmitButton size="sm" variant="outline">
                        {c.reviewed ? "Vrati u nove" : "Označi pregledano"}
                      </SubmitButton>
                    </form>
                    <form action={removeComment}>
                      <input type="hidden" name="id" value={c.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Obriši
                      </SubmitButton>
                    </form>
                  </div>
                ),
              },
            }))}
            empty="Nema komentara."
          />
        </Card>
      </div>
    </>
  );
}
