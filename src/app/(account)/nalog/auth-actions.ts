"use server";

import { signIn } from "@/lib/auth/auth";
import { customerCallback } from "@/lib/auth/customer-callback";

export async function googleAction(formData: FormData) {
  await signIn("google", {
    redirectTo: customerCallback(String(formData.get("callbackUrl") ?? "")),
  });
}

export async function facebookAction(formData: FormData) {
  await signIn("facebook", {
    redirectTo: customerCallback(String(formData.get("callbackUrl") ?? "")),
  });
}

export async function appleAction(formData: FormData) {
  await signIn("apple", {
    redirectTo: customerCallback(String(formData.get("callbackUrl") ?? "")),
  });
}
