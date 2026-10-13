"use server";
import { revalidatePath, updateTag } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
export async function refreshAdminData(path: string) {
  await requireAdminAction();
  if (!/^\/admin(?:\/[a-zA-Z0-9_\-/]+)?$/.test(path) || path.includes("..")) throw new Error("Neispravna putanja.");
  updateTag("admin-dashboard-analytics");
  revalidatePath(path);
}
