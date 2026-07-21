import "server-only";

import { Readable } from "node:stream";
import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { Upload } from "tus-js-client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import { envValue } from "@/lib/env";
import { normalizeRabaluxMediaUrl } from "./parser";
import { directStorageOrigin } from "./media-upload";
import {
  isRabaluxSupplierOperational,
  RABALUX_INTEGRATION_KEY,
} from "./config";

const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const VARIANTS = [
  { name: "thumb", width: 160, quality: 76 },
  { name: "card", width: 640, quality: 80 },
  { name: "pdp", width: 1280, quality: 84 },
] as const;

type MediaTarget = {
  assetId: string;
  assetType: "MEDIA" | "ATTACHMENT";
};

export async function mirrorRabaluxProductMedia(
  productId: string,
  target?: MediaTarget,
) {
  const product = await db.product.findFirst({
    where: {
      id: productId,
      supplier: { integrationKey: RABALUX_INTEGRATION_KEY },
    },
    select: {
      id: true,
      fullPrice: true,
      articleStatus: true,
      categories: { select: { categoryId: true }, take: 1 },
      supplier: { select: { integrationKey: true, enabled: true } },
      media: {
        where: { syncStatus: { not: "READY" } },
        orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
      },
      attachments: {
        where: { syncStatus: { not: "READY" } },
        orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
      },
    },
  });
  if (!product) throw new Error("Rabalux product does not exist.");
  if (!isRabaluxSupplierOperational(product.supplier)) {
    throw new Error("Supplier integration is disabled.");
  }

  const selected = target
    ? target.assetType === "MEDIA"
      ? product.media.find((asset) => asset.id === target.assetId)
      : product.attachments.find((asset) => asset.id === target.assetId)
    : product.media[0] ?? product.attachments[0];
  const selectedType = target?.assetType ??
    (selected && product.media.some((asset) => asset.id === selected.id)
      ? "MEDIA"
      : "ATTACHMENT");
  if (!selected) {
    await refreshRabaluxProductActivity(product.id);
    return { productId, media: 0, attachments: 0, remainingQueued: false };
  }

  try {
    if (selectedType === "MEDIA") {
      const mediaAsset = product.media.find((asset) => asset.id === selected.id);
      if (!mediaAsset) throw new Error("Rabalux media target does not exist.");
      await mirrorMediaAsset(mediaAsset);
    } else {
      await mirrorAttachment(selected);
    }
  } catch (error) {
    if (selectedType === "MEDIA") {
      await db.productMedia.update({
        where: { id: selected.id },
        data: { syncStatus: "FAILED" },
      });
    } else {
      await db.productAttachment.update({
        where: { id: selected.id },
        data: { syncStatus: "FAILED" },
      });
    }
    await enqueueNextRabaluxMediaAsset(product.id, selected.id);
    await refreshRabaluxProductActivity(product.id);
    throw error;
  }

  await refreshRabaluxProductActivity(product.id);
  const remainingQueued = await enqueueNextRabaluxMediaAsset(
    product.id,
    selected.id,
  );
  return {
    productId,
    media: selectedType === "MEDIA" ? 1 : 0,
    attachments: selectedType === "ATTACHMENT" ? 1 : 0,
    remainingQueued,
  };
}

async function mirrorMediaAsset(asset: {
  id: string;
  kind: "IMAGE" | "VIDEO" | "VIDEO_3D";
  url: string;
  sourceUrl: string | null;
}) {
  const sourceUrl = requireTrustedSource(asset.sourceUrl);
  const maxBytes = asset.kind === "IMAGE" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (asset.kind !== "IMAGE") {
    await streamVideoToStorage(sourceUrl, asset.url, maxBytes);
    await db.productMedia.update({
      where: { id: asset.id },
      data: { syncStatus: "READY" },
    });
    return;
  }
  const downloaded = await downloadAsset(sourceUrl, maxBytes);
  if (asset.kind === "IMAGE" && !downloaded.contentType.startsWith("image/")) {
    throw new Error("Rabalux image response has an invalid content type.");
  }

  const storage = createAdminClient().storage.from(getProductMediaBucket());
  await upload(storage, asset.url, downloaded.buffer, downloaded.contentType);

  const image = sharp(downloaded.buffer, { failOn: "error" }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Rabalux image dimensions could not be verified.");
  }
  const variantKeys: Record<(typeof VARIANTS)[number]["name"], string> = {
    thumb: "",
    card: "",
    pdp: "",
  };
  for (const variant of VARIANTS) {
    const key = variantKey(asset.url, variant.name, variant.width);
    const buffer = await sharp(downloaded.buffer, { failOn: "error" })
      .rotate()
      .resize({
        width: variant.width,
        height: variant.width,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: variant.quality, effort: 4 })
      .toBuffer();
    await upload(storage, key, buffer, "image/webp");
    variantKeys[variant.name] = key;
  }
  await db.productMedia.update({
    where: { id: asset.id },
    data: {
      syncStatus: "READY",
      width: metadata.width,
      height: metadata.height,
      thumbUrl: variantKeys.thumb,
      cardUrl: variantKeys.card,
      pdpUrl: variantKeys.pdp,
    },
  });
}

async function mirrorAttachment(asset: {
  id: string;
  url: string;
  sourceUrl: string | null;
}) {
  const sourceUrl = requireTrustedSource(asset.sourceUrl);
  const downloaded = await downloadAsset(sourceUrl, DOCUMENT_MAX_BYTES);
  if (downloaded.contentType !== "application/pdf" && !looksLikePdf(downloaded.buffer)) {
    throw new Error("Rabalux document response is not a PDF.");
  }
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  await upload(storage, asset.url, downloaded.buffer, "application/pdf");
  await db.productAttachment.update({
    where: { id: asset.id },
    data: { syncStatus: "READY" },
  });
}

async function refreshRabaluxProductActivity(productId: string) {
  const product = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      fullPrice: true,
      articleStatus: true,
      categories: { select: { categoryId: true }, take: 1 },
      media: {
        where: { kind: "IMAGE", syncStatus: "READY" },
        select: { id: true },
        take: 1,
      },
    },
  });
  await db.product.update({
    where: { id: productId },
    data: {
      isActive:
        Number(product.fullPrice) > 0 &&
        product.articleStatus !== "ARH" &&
        product.categories.length > 0 &&
        product.media.length > 0,
    },
  });
}

export async function syncPendingRabaluxMedia(limit = 100) {
  const supplier = await db.supplier.findUniqueOrThrow({
    where: { integrationKey: RABALUX_INTEGRATION_KEY },
    select: { id: true, integrationKey: true, enabled: true },
  });
  if (!isRabaluxSupplierOperational(supplier)) {
    throw new Error("Supplier integration is disabled.");
  }
  const run = await db.importRun.create({
    data: { supplierId: supplier.id, kind: "MEDIA", status: "RUNNING" },
  });
  const products = await db.product.findMany({
    where: {
      supplierId: supplier.id,
      OR: [
        { media: { some: { syncStatus: { not: "READY" } } } },
        { attachments: { some: { syncStatus: { not: "READY" } } } },
      ],
    },
    select: {
      id: true,
      media: {
        where: { syncStatus: { not: "READY" } },
        orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
        select: { id: true },
        take: 1,
      },
      attachments: {
        where: { syncStatus: { not: "READY" } },
        orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
        select: { id: true },
        take: 1,
      },
    },
    take: Math.min(Math.max(limit, 1), 500),
    orderBy: { updatedAt: "asc" },
  });
  let ok = 0;
  const errors: Array<{ productId: string; message: string }> = [];
  for (const product of products) {
    const target = product.media[0]
      ? { assetId: product.media[0].id, assetType: "MEDIA" as const }
      : product.attachments[0]
        ? {
            assetId: product.attachments[0].id,
            assetType: "ATTACHMENT" as const,
          }
        : null;
    if (!target) continue;
    try {
      await enqueueRabaluxMediaAsset(product.id, target);
      ok++;
    } catch (error) {
      errors.push({
        productId: product.id,
        message:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : String(error).slice(0, 1000),
      });
    }
  }
  await db.importRun.update({
    where: { id: run.id },
    data: {
      status: errors.length ? (ok ? "PARTIAL" : "FAILED") : "SUCCESS",
      finishedAt: new Date(),
      recordsRead: products.length,
      recordsOk: ok,
      recordsFail: errors.length,
      errorMessage: errors[0]?.message ?? null,
      errors: errors.length
        ? (errors.slice(0, 50) as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      metadata: {
        remainingMayExist: products.length === Math.min(Math.max(limit, 1), 500),
      },
    },
  });
  return { runId: run.id, read: products.length, ok, failed: errors.length };
}

async function enqueueNextRabaluxMediaAsset(
  productId: string,
  excludeAssetId?: string,
) {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      media: {
        where: {
          syncStatus: { not: "READY" },
          ...(excludeAssetId ? { id: { not: excludeAssetId } } : {}),
        },
        orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
        select: { id: true },
        take: 1,
      },
      attachments: {
        where: {
          syncStatus: { not: "READY" },
          ...(excludeAssetId ? { id: { not: excludeAssetId } } : {}),
        },
        orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
        select: { id: true },
        take: 1,
      },
    },
  });
  const target = product?.media[0]
    ? { assetId: product.media[0].id, assetType: "MEDIA" as const }
    : product?.attachments[0]
      ? {
          assetId: product.attachments[0].id,
          assetType: "ATTACHMENT" as const,
        }
      : null;
  if (!target) return false;
  await enqueueRabaluxMediaAsset(productId, target);
  return true;
}

async function enqueueRabaluxMediaAsset(
  productId: string,
  target: MediaTarget,
) {
  return enqueueBackgroundJob({
    kind: "RABALUX_MEDIA_PRODUCT",
    payload: { productId, ...target },
    idempotencyKey: `rabalux-media-asset:${target.assetType}:${target.assetId}`,
    maxAttempts: 12,
  });
}

function requireTrustedSource(value: string | null) {
  const normalized = value ? normalizeRabaluxMediaUrl(value) : null;
  if (!normalized || normalized !== value) {
    throw new Error("Untrusted Rabalux media source.");
  }
  return normalized;
}

async function downloadAsset(url: string, maxBytes: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { "User-Agent": "SvetPovoljnihCena-RabaluxMedia/1.0" },
    });
    if (!response.ok) {
      throw new Error(`Rabalux media returned HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) throw new Error("Rabalux media file is too large.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) {
      throw new Error("Rabalux media file size is invalid.");
    }
    return {
      buffer,
      contentType:
        response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
        "application/octet-stream",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function streamVideoToStorage(
  sourceUrl: string,
  storageKey: string,
  maxBytes: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    const source = await fetch(sourceUrl, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { "User-Agent": "SvetPovoljnihCena-RabaluxMedia/1.0" },
    });
    if (!source.ok || !source.body) {
      throw new Error(`Rabalux video returned HTTP ${source.status}.`);
    }
    const contentType =
      source.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
      "";
    if (!contentType.startsWith("video/")) {
      throw new Error("Rabalux video response has an invalid content type.");
    }
    const contentLength = Number(source.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) {
      throw new Error("Rabalux video file is too large.");
    }
    let received = 0;
    const limiter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, streamController) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          streamController.error(new Error("Rabalux video file is too large."));
          controller.abort();
          return;
        }
        streamController.enqueue(chunk);
      },
    });
    const supabaseUrl = envValue("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) {
      throw new Error("Product media storage is not configured.");
    }
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      throw new Error("Rabalux video response does not include a valid size.");
    }
    const stream = Readable.fromWeb(
      source.body.pipeThrough(limiter) as Parameters<typeof Readable.fromWeb>[0],
    );
    await uploadVideoResumable({
      stream,
      uploadSize: contentLength,
      storageKey,
      contentType,
      supabaseUrl,
      serviceRole,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadVideoResumable(args: {
  stream: Readable;
  uploadSize: number;
  storageKey: string;
  contentType: string;
  supabaseUrl: string;
  serviceRole: string;
  signal: AbortSignal;
}) {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => args.signal.removeEventListener("abort", abort);
    const abort = () => {
      void upload.abort().finally(() => reject(new Error("Video upload timed out.")));
    };
    const upload = new Upload(args.stream, {
      endpoint: `${directStorageOrigin(args.supabaseUrl)}/storage/v1/upload/resumable`,
      headers: {
        apikey: args.serviceRole,
        Authorization: `Bearer ${args.serviceRole}`,
        "x-upsert": "true",
      },
      chunkSize: TUS_CHUNK_BYTES,
      uploadSize: args.uploadSize,
      uploadDataDuringCreation: true,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: getProductMediaBucket(),
        objectName: args.storageKey,
        contentType: args.contentType,
        cacheControl: "31536000",
      },
      onError: (error) => {
        cleanup();
        reject(error);
      },
      onSuccess: () => {
        cleanup();
        resolve();
      },
    });
    args.signal.addEventListener("abort", abort, { once: true });
    upload.start();
  });
}

async function upload(
  storage: ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>,
  key: string,
  body: Buffer,
  contentType: string,
) {
  const { error } = await storage.upload(key, body, {
    contentType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw new Error(`Product media upload failed: ${error.message}`);
}

function variantKey(originalKey: string, name: string, width: number) {
  const dot = originalKey.lastIndexOf(".");
  const stem = dot > originalKey.lastIndexOf("/") ? originalKey.slice(0, dot) : originalKey;
  return `${stem}-${name}-${width}.webp`;
}

function looksLikePdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}
