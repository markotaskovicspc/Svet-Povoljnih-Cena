import fs from "node:fs";
import { parse } from "dotenv";
import webpush from "web-push";

const file = ".env.local";
const original = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const env = parse(original);
const configured = value => value?.trim() && !value.startsWith("GET_FROM_");
if (configured(env.VAPID_PUBLIC_KEY) || configured(env.VAPID_PRIVATE_KEY)) {
  if (!configured(env.VAPID_PUBLIC_KEY) || !configured(env.VAPID_PRIVATE_KEY)) throw new Error("Incomplete VAPID pair. Restore the existing pair before setup.");
  console.log("Existing VAPID keys preserved. Copy the same values to Vercel Production.");
} else {
  const keys = webpush.generateVAPIDKeys();
  const cleaned = original.replace(/^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=.*\r?\n?/gm, "");
  fs.writeFileSync(file, `${cleaned.trimEnd()}\n\n# Admin order notifications — keep this key pair across deployments\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=https://www.svetpovoljnihcena.rs\n`, { mode: 0o600 });
  console.log("VAPID keys saved to .env.local without printing secrets. Copy these three values to Vercel Production, apply migration, and redeploy.");
}
