import { requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { ContentPageEditor } from "@/components/admin/content-page-editor";
import { saveContentPageAction } from "../actions";

export const metadata = {
  title: "Nova stranica",
  robots: { index: false, follow: false },
};

export default async function NewContentPage() {
  await requireAdminAction(["CONTENT"]);
  return (
    <>
      <PageHeader
        title="Nova stranica"
        description="Nova stranica počinje kao nacrt i nije javna dok je ne objavite."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/sadrzaj", label: "Stranice" },
          { label: "Nova" },
        ]}
      />
      <div className="px-8 py-6">
        <ContentPageEditor
          action={saveContentPageAction}
          values={{
            slug: "",
            kind: "CUSTOM",
            template: "STANDARD",
            eyebrow: null,
            heroNote: null,
            title: "",
            lead: null,
            bodyMarkdown: "## Nova sekcija {#nova-sekcija}\n\nUnesite tekst stranice.",
            seoTitle: null,
            seoDescription: null,
            footerVisible: false,
            footerLabel: null,
            footerColumn: null,
            footerOrder: null,
            lockedSlug: false,
          }}
        />
      </div>
    </>
  );
}
