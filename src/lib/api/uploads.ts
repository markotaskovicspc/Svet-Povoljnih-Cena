import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_RECLAMATION_UPLOAD_BUCKET = "reclamation-uploads";
const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
} as const;
const ALLOWED_CONTENT_TYPES = Object.keys(ALLOWED_IMAGE_TYPES) as [
  keyof typeof ALLOWED_IMAGE_TYPES,
  ...(keyof typeof ALLOWED_IMAGE_TYPES)[],
];

export const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  /** MIME type, e.g. "image/jpeg". */
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  /** Bytes; capped at 5MB per spec §4.1. */
  bytes: z.int().positive().max(5 * 1024 * 1024),
  scope: z.enum(["reclamation"]).default("reclamation"),
  orderNumberOrFiscal: z.string().min(3).max(80),
  sku: z.string().min(1).max(64),
  accessToken: z.string().min(16).max(256).optional(),
}).superRefine((input, ctx) => {
  const ext = fileExtension(input.filename);
  if (!ext || !ALLOWED_IMAGE_TYPES[input.contentType].includes(ext as never)) {
    ctx.addIssue({
      code: "custom",
      path: ["filename"],
      message: "Ekstenzija fotografije se ne poklapa sa MIME tipom.",
    });
  }
});

export type PresignInput = z.infer<typeof presignSchema>;

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  /** Echoed back so clients can correlate. */
  key: string;
  expiresInSec: number;
}

export async function presignUpload(
  input: PresignInput,
  scope: { orderNumber: string; sku: string },
): Promise<PresignResult> {
  const ext = fileExtension(input.filename)!;
  const id = randomBytes(12).toString("hex");
  const key = [
    input.scope,
    safeSegment(scope.orderNumber),
    safeSegment(scope.sku),
    new Date().toISOString().slice(0, 10),
    `${id}.${ext}`,
  ].join("/");
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

export function isAllowedReclamationPhotoUrl(value: string) {
  const bucket = reclamationUploadBucket();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const markerPublic = `/storage/v1/object/public/${bucket}/`;
  const markerSigned = `/storage/v1/object/sign/${bucket}/`;
  const path = decodeURIComponent(url.pathname);
  const key = path.includes(markerPublic)
    ? path.slice(path.indexOf(markerPublic) + markerPublic.length)
    : path.includes(markerSigned)
      ? path.slice(path.indexOf(markerSigned) + markerSigned.length)
      : "";
  return isAllowedReclamationObjectKey(key);
}

export function isAllowedReclamationObjectKey(key: string) {
  const parts = key.split("/").filter(Boolean);
  if (parts.length !== 5 || parts[0] !== "reclamation") return false;
  const filename = parts[4] ?? "";
  const ext = fileExtension(filename);
  if (!ext) return false;
  return Object.values(ALLOWED_IMAGE_TYPES).some((list) =>
    list.includes(ext as never),
  );
}

function reclamationUploadBucket() {
  return (
    process.env.SUPABASE_RECLAMATION_UPLOAD_BUCKET ??
    process.env.NEXT_PUBLIC_SUPABASE_RECLAMATION_UPLOAD_BUCKET ??
    DEFAULT_RECLAMATION_UPLOAD_BUCKET
  );
}

function fileExtension(filename: string) {
  return filename.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? null;
}

function safeSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}
