import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { reportDestinationsForRole } from "@/lib/admin/reports-hub";
import { PageHeader } from "@/components/admin/page-header";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Izveštajni centar",
  robots: { index: false, follow: false },
};

export default async function ReportsHubPage() {
  const admin = await requireAdminAction(["CONTENT", "OPS", "ADS"]);
  const destinations = reportDestinationsForRole(admin.role);

  return (
    <>
      <PageHeader
        title="Izveštajni centar"
        description="Namenski izveštaji i analitički alati dostupni vašoj ulozi. Zbirni poslovni pregled nalazi se na Kontrolnoj tabli."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { label: "Izveštajni centar" },
        ]}
      />
      <div className="px-8 py-6">
        <nav
          aria-label="Dostupni namenski izveštaji"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {destinations.map((destination) => (
            <Link
              key={destination.href}
              href={destination.href}
              className="group rounded-xl border border-border/60 bg-surface p-5 transition hover:border-walnut/40 hover:shadow-sm"
            >
              <span className="font-display text-xl text-ink-900 transition group-hover:text-walnut">
                {destination.title}
              </span>
              <span className="mt-2 block text-sm leading-6 text-ink-500">
                {destination.description}
              </span>
              <span className="mt-4 block text-sm font-medium text-walnut">
                Otvori izveštaj →
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
