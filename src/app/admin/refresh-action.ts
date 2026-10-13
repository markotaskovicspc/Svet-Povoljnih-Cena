"use server";
import { revalidatePath, updateTag } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
export async function refreshAdminData(path: string) {
  const warehouse = path === "/admin/magacin" || path.startsWith("/admin/magacin/");
  await requireAdminAction(warehouse ? ["WAREHOUSE", "OPS"] : undefined);
  if (!/^\/admin(?:\/[a-zA-Z0-9_\-/]+)?$/.test(path) || path.includes("..")) throw new Error("Neispravna putanja.");
  if (!warehouse) updateTag("admin-dashboard-analytics");
  revalidatePath(path);
}
