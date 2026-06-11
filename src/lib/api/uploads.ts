import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_RECLAMATION_UPLOAD_BUCKET = "reclamation-uploads";

export const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  /** MIME type, e.g. "image/jpeg". */
  contentType: z.string().min(3).max(120),
  /** Bytes; capped at 5MB per spec §4.1. */
  bytes: z.int().positive().max(5 * 1024 * 1024),
  scope: z.enum(["reclamation"]).default("reclamation"),
});

export type PresignInput = z.infer<typeof presignSchema>;

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  /** Echoed back so clients can correlate. */
  key: string;
  expiresInSec: number;
}

export async function presignUpload(input: PresignInput): Promise<PresignResult> {
  const ext = (input.filename.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "bin").toLowerCase();
  const id = randomBytes(12).toString("hex");
  const key = `${input.scope}/${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;
  const bucket =
    process.env.SUPABASE_RECLAMATION_UPLOAD_BUCKET ??
    process.env.NEXT_PUBLIC_SUPABASE_RECLAMATION_UPLOAD_BUCKET ??
    DEFAULT_RECLAMATION_UPLOAD_BUCKET;
  const storage = createAdminClient().storage.from(bucket);
  const { data, error } = await storage.createSignedUploadUrl(key);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Upload URL nije moguće kreirati.");
  }
  const publicUrl = storage.getPublicUrl(key).data.publicUrl;
  return {
    uploadUrl: data.signedUrl,
    publicUrl,
    key,
    expiresInSec: 600,
  };
}
