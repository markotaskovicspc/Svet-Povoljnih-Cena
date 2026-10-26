import Link from "next/link";
import { getCurrentAdmin } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { effectiveAdminModules, adminAccessHome } from "@/lib/admin/access-policy";

export default async function AccessDeniedPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/prijava");
  return <main className="space-y-3 p-8"><h1 className="text-2xl font-semibold">Pristup nije odobren</h1>
    <p>Ovaj nalog nema pristup traženom modulu. Za promenu pristupa obratite se administratoru.</p>
    {effectiveAdminModules(admin).length > 0 && <Link className="underline" href={adminAccessHome(admin)}>Otvori dostupne module</Link>}
  </main>;
}
