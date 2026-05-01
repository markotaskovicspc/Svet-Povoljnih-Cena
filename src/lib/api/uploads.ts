import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Presigned upload URL stub (Phase 3C — item 5b).
 *
 * Returns a placeholder `uploadUrl` + `publicUrl`. The real implementation in
 * Phase 6 will sign an S3 / R2 PUT URL — clients PUT the file there directly,
 * then submit `publicUrl` back to the reclamation form. Keeping the contract
 * stable now so the form code can ship without rework later.
 */

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

export function presignUpload(input: PresignInput): PresignResult {
  const ext = (input.filename.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "bin").toLowerCase();
  const id = randomBytes(12).toString("hex");
  const key = `${input.scope}/${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;
  const base = process.env.CLOUD_BASE_URL?.replace(/\/$/, "") ?? "https://uploads.spc.local";
  return {
    uploadUrl: `${base}/_presigned/${key}?stub=1`,
    publicUrl: `${base}/${key}`,
    key,
    expiresInSec: 600,
  };
}
