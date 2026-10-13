"use server";
import { signOut } from "@/lib/auth/auth";
export async function warehouseSignOut() {
  await signOut({ redirectTo: "/admin/magacin/prijava" });
}
