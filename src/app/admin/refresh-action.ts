"use server";
import { revalidatePath, updateTag } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
import { adminModuleForPage } from "@/lib/admin/access-policy";
export async function refreshAdminData(path: string) {
  const warehouse = path === "/admin/magacin" || path.startsWith("/admin/magacin/");
  if (!/^\/admin(?:\/[a-zA-Z0-9_\-/]+)?$/.test(path) || path.includes("..")) throw new Error("Neispravna putanja.");
  await requireAdminAction(warehouse ? ["WAREHOUSE", "OPS"] : undefined, adminModuleForPage(path) ?? undefined);
  if (!warehouse) updateTag("admin-dashboard-analytics");
  revalidatePath(path);
}
