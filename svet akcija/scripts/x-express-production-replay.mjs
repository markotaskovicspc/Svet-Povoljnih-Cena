#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const { loadEnvConfig } = nextEnv;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "../..");
const RECEIPT_DIR = path.resolve(SCRIPT_DIR, "../output/x-express-production-replay");

const MANIFEST = Object.freeze({
  count: 45,
  packageCount: 63,
  createdFrom: new Date("2026-08-27T09:20:39.000Z"),
  createdThrough: new Date("2026-08-27T10:35:24.000Z"),
  sha256: "867be51bddc444d3b2401922b2f5f8e17534a78ba97a0ebdc205d6c7a1cea592",
  canaryOrder: "SPC-2026-000046",
});

const CANARY_CONFIRMATION = "SEND_ONE_XEXPRESS_PRODUCTION_CANARY";
const REMAINING_CONFIRMATION = "NIKO_CONFIRMED_SEND_REMAINING_44";
const CLAIMED_STATUS = "PRODUCTION_REPLAY_CLAIMED";
const ANNOUNCED_STATUS = "PRODUCTION_ANNOUNCED";
const REJECTED_STATUS = "PRODUCTION_REPLAY_REJECTED";
const UNCERTAIN_STATUS = "PRODUCTION_REPLAY_NEEDS_RECONCILIATION";

class GuardError extends Error {}

class ProviderRejectedError extends Error {
  constructor(message, status, raw) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function configured(value) {
  const normalized = value?.trim() ?? "";
  return normalized && !normalized.startsWith("GET_FROM_") ? normalized : "";
}

function bool(value) {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function parseArgs(argv) {
  const [command = "audit", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new GuardError(`Nepoznat argument: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function databaseUrl() {
  const raw = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
  if (!raw) throw new GuardError("Nedostaje DATABASE_URL/POSTGRES_URL_NON_POOLING.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    const sslMode =
      process.env.DATABASE_SSLMODE?.trim() ||
      url.searchParams.get("sslmode")?.trim() ||
      "require";
    url.searchParams.set("sslmode", sslMode);
    if (["prefer", "require", "verify-ca"].includes(sslMode.toLowerCase())) {
      url.searchParams.set("uselibpqcompat", "true");
    } else {
      url.searchParams.delete("uselibpqcompat");
    }
  }
  return url.toString();
}

function createDb() {
  return new PrismaClient({ adapter: new PrismaPg(databaseUrl()) });
}

function payloadFor(candidate) {
  return record(record(candidate.rawCreateResponse).createOrderPayload);
}

function replayFor(candidate) {
  return record(record(candidate.rawCreateResponse).xExpressProductionReplay);
}

function packageCodes(candidate) {
  const packages = payloadFor(candidate).Packages;
  return (Array.isArray(packages) ? packages : [])
    .map((item) => record(item).Code)
    .filter((value) => typeof value === "string" && value.length > 0);
}

function originalTestGuid(candidate) {
  const raw = record(candidate.rawCreateResponse);
  const replay = record(raw.xExpressProductionReplay);
  const announcement = record(raw.xExpressAnnouncement);
  return (
    replay.testRequestGuid ??
    announcement.requestGuid ??
    candidate.providerShipmentId ??
    ""
  );
}

export function manifestTuple(candidate) {
  return [
    candidate.order.number,
    candidate.id,
    candidate.trackingNo,
    originalTestGuid(candidate),
    packageCodes(candidate).join(","),
  ].join("|");
}

export function manifestFingerprint(candidates) {
  return createHash("sha256")
    .update(candidates.map(manifestTuple).join("\n"))
    .digest("hex");
}

function assertManifest(candidates) {
  if (candidates.length !== MANIFEST.count) {
    throw new GuardError(`Očekivano je tačno 45 naloga, pronađeno ${candidates.length}.`);
  }
  const fingerprint = manifestFingerprint(candidates);
  if (fingerprint !== MANIFEST.sha256) {
    throw new GuardError(
      `Manifest fingerprint se promenio (${fingerprint}); slanje je blokirano.`,
    );
  }
  const shipmentIds = candidates.map((item) => item.id);
  const testGuids = candidates.map(originalTestGuid);
  const codes = candidates.flatMap(packageCodes);
  if (new Set(shipmentIds).size !== candidates.length) {
    throw new GuardError("Manifest sadrži dupliran Shipment ID.");
  }
  if (new Set(testGuids).size !== candidates.length || testGuids.some((value) => !value)) {
    throw new GuardError("Test requestGuid nije potpun ili nije jedinstven.");
  }
  if (codes.length !== MANIFEST.packageCount || new Set(codes).size !== codes.length) {
    throw new GuardError("Očekivana su 63 jedinstvena koda paketa.");
  }
  for (const candidate of candidates) {
    const payload = payloadFor(candidate);
    if (candidate.status !== "CREATED") {
      throw new GuardError(`${candidate.order.number}: status više nije CREATED.`);
    }
    if (payload.Reference !== candidate.id) {
      throw new GuardError(`${candidate.order.number}: Reference nije Shipment ID.`);
    }
    if (!/^AAA\d{10}$/.test(candidate.trackingNo ?? "")) {
      throw new GuardError(`${candidate.order.number}: tracking kod nije očekivanog formata.`);
    }
    const replay = replayFor(candidate);
    if (
      replay.state === "ANNOUNCED" &&
      (replay.productionRequestGuid !== candidate.providerShipmentId ||
        candidate.providerStatusCode !== ANNOUNCED_STATUS)
    ) {
      throw new GuardError(`${candidate.order.number}: produkcioni replay zapis nije usklađen.`);
    }
  }
}

async function loadCandidates(db) {
  const candidates = await db.shipment.findMany({
    where: {
      provider: "X_EXPRESS",
      createdAt: { gte: MANIFEST.createdFrom, lte: MANIFEST.createdThrough },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      trackingNo: true,
      providerOrderId: true,
      providerShipmentId: true,
      providerStatusCode: true,
      rawCreateResponse: true,
      order: { select: { number: true } },
    },
  });
  assertManifest(candidates);
  return candidates;
}

function stateOf(candidate) {
  return replayFor(candidate).state ?? "TEST_ANNOUNCED";
}

function auditSummary(candidates) {
  const states = {};
  for (const candidate of candidates) {
    const state = stateOf(candidate);
    states[state] = (states[state] ?? 0) + 1;
  }
  const firstBatch = candidates.filter(
    (item) => item.createdAt < new Date("2026-08-27T10:00:00.000Z"),
  );
  const secondBatch = candidates.filter(
    (item) => item.createdAt >= new Date("2026-08-27T10:00:00.000Z"),
  );
  return {
    ok: true,
    shipmentCount: candidates.length,
    packageCount: candidates.flatMap(packageCodes).length,
    fingerprint: manifestFingerprint(candidates),
    states,
    batches: [
      { count: firstBatch.length, from: firstBatch[0]?.order.number, through: firstBatch.at(-1)?.order.number },
      { count: secondBatch.length, from: secondBatch[0]?.order.number, through: secondBatch.at(-1)?.order.number },
    ],
    canary: {
      order: MANIFEST.canaryOrder,
      trackingNo: candidates.find((item) => item.order.number === MANIFEST.canaryOrder)?.trackingNo,
      state: stateOf(candidates.find((item) => item.order.number === MANIFEST.canaryOrder)),
    },
  };
}

function requireProductionConfig() {
  const cfg = {
    env: configured(process.env.X_EXPRESS_ENV).toLowerCase(),
    enabled: bool(process.env.X_EXPRESS_ENABLED),
    accepted: bool(process.env.X_EXPRESS_PRODUCTION_ACCEPTED),
    baseUrl: configured(process.env.X_EXPRESS_BASE_URL).replace(/\/+$/, ""),
    path: configured(process.env.X_EXPRESS_CREATE_ORDER_PATH),
    apiUser: configured(process.env.X_EXPRESS_API_USER),
    apiKey: configured(process.env.X_EXPRESS_API_KEY),
  };
  if (cfg.env !== "production") {
    throw new GuardError("X_EXPRESS_ENV mora izričito biti production.");
  }
  if (!cfg.enabled || !cfg.accepted) {
    throw new GuardError(
      "X_EXPRESS_ENABLED i X_EXPRESS_PRODUCTION_ACCEPTED moraju biti true.",
    );
  }
  if (cfg.baseUrl !== "https://portal.pm.xexpress.rs") {
    throw new GuardError("X Express base URL nije na dozvoljenoj listi.");
  }
  if (cfg.path !== "/api/order/add") {
    throw new GuardError("X Express create-order putanja nije /api/order/add.");
  }
  if (!cfg.apiUser || !cfg.apiKey) {
    throw new GuardError("X Express API user/key nisu konfigurisani.");
  }
  return cfg;
}

function unwrapRecord(value) {
  const top = record(value);
  for (const key of ["data", "result", "item", "shipment", "order", "nalog"]) {
    if (Object.keys(record(top[key])).length > 0) return record(top[key]);
  }
  return top;
}

export function extractRequestGuid(value) {
  const response = unwrapRecord(value);
  for (const key of ["requestGuid", "RequestGuid"]) {
    const guid = response[key];
    if (typeof guid === "string" && /^[0-9a-f-]{36}$/i.test(guid)) return guid;
  }
  return null;
}

export function isXExpressOrderCode(value) {
  return /^\d{2}-\d{10}$/.test(value ?? "");
}

function safeProviderMessage(raw, fallback) {
  const response = unwrapRecord(raw);
  for (const key of ["detail", "message", "title", "error", "description"]) {
    const value = response[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 1_000);
  }
  return fallback;
}

async function providerPost(cfg, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${cfg.baseUrl}${cfg.path}`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-user": cfg.apiUser,
        "x-api-key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let raw = {};
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      raw = { nonJsonResponse: text.slice(0, 2_000) };
    }
    if (!response.ok) {
      throw new ProviderRejectedError(
        safeProviderMessage(raw, `X Express je vratio HTTP ${response.status}.`),
        response.status,
        raw,
      );
    }
    const requestGuid = extractRequestGuid(raw);
    if (!requestGuid) {
      const error = new Error("Uspešan HTTP odgovor nema requestGuid; ishod je neodređen.");
      error.providerRaw = raw;
      throw error;
    }
    return { status: response.status, raw, requestGuid };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeReceipt(data) {
  await mkdir(RECEIPT_DIR, { recursive: true });
  const safeOrder = data.order.replace(/[^A-Za-z0-9_-]/g, "_");
  const file = path.join(
    RECEIPT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeOrder}.json`,
  );
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return file;
}

async function claimCandidate(db, candidate, kind) {
  if (stateOf(candidate) !== "TEST_ANNOUNCED") {
    throw new GuardError(`${candidate.order.number}: replay state je ${stateOf(candidate)}.`);
  }
  if (candidate.providerStatusCode !== null) {
    throw new GuardError(`${candidate.order.number}: providerStatusCode više nije prazan.`);
  }
  const raw = record(candidate.rawCreateResponse);
  const testRequestGuid = originalTestGuid(candidate);
  if (candidate.providerShipmentId !== testRequestGuid) {
    throw new GuardError(`${candidate.order.number}: aktivni GUID nije originalni test GUID.`);
  }
  const attemptId = randomUUID();
  const startedAt = new Date().toISOString();
  const claimedRaw = {
    ...raw,
    xExpressProductionReplay: {
      state: "CLAIMED",
      kind,
      attemptId,
      startedAt,
      testRequestGuid,
      testAnnouncement: raw.xExpressAnnouncement ?? null,
      testCreateOrderResponse: raw.createOrder ?? null,
    },
  };
  const claimed = await db.shipment.updateMany({
    where: {
      id: candidate.id,
      updatedAt: candidate.updatedAt,
      status: "CREATED",
      provider: "X_EXPRESS",
      providerShipmentId: testRequestGuid,
      providerStatusCode: null,
    },
    data: {
      providerStatusCode: CLAIMED_STATUS,
      syncError: null,
      rawCreateResponse: claimedRaw,
    },
  });
  if (claimed.count !== 1) {
    throw new GuardError(`${candidate.order.number}: claim nije uspeo; ponovite audit.`);
  }
  return { attemptId, startedAt, testRequestGuid, claimedRaw };
}

async function markUncertain(db, candidate, claim, error, providerRaw) {
  const message = error instanceof Error ? error.message : "Nepoznat ishod X Express zahteva.";
  const state = error instanceof ProviderRejectedError ? "REJECTED" : "NEEDS_RECONCILIATION";
  const providerStatusCode =
    error instanceof ProviderRejectedError ? REJECTED_STATUS : UNCERTAIN_STATUS;
  const raw = {
    ...claim.claimedRaw,
    xExpressProductionReplay: {
      ...record(claim.claimedRaw.xExpressProductionReplay),
      state,
      finishedAt: new Date().toISOString(),
      error: message.slice(0, 1_000),
      ...(error instanceof ProviderRejectedError ? { httpStatus: error.status } : {}),
    },
  };
  const receipt = await writeReceipt({
    kind: "x-express-production-replay",
    state,
    order: candidate.order.number,
    shipmentId: candidate.id,
    trackingNo: candidate.trackingNo,
    attemptId: claim.attemptId,
    testRequestGuid: claim.testRequestGuid,
    error: message.slice(0, 1_000),
    createdAt: new Date().toISOString(),
  });
  await db.$transaction(async (tx) => {
    const updated = await tx.shipment.updateMany({
      where: {
        id: candidate.id,
        providerShipmentId: claim.testRequestGuid,
        providerStatusCode: CLAIMED_STATUS,
      },
      data: {
        providerStatusCode,
        syncError: message.slice(0, 4_000),
        rawCreateResponse: raw,
      },
    });
    if (updated.count !== 1) throw new GuardError("Nije sačuvan neodređen replay ishod.");
    await tx.shipmentEvent.create({
      data: {
        shipmentId: candidate.id,
        status: "CREATED",
        message:
          state === "REJECTED"
            ? `X Express produkcioni replay je odbijen: ${message.slice(0, 500)}`
            : `X Express produkcioni replay zahteva ručno usaglašavanje: ${message.slice(0, 500)}`,
        raw: providerRaw ?? undefined,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "xExpress.productionReplay.failed",
        entity: "Shipment",
        entityId: candidate.id,
        diff: {
          state,
          orderNumber: candidate.order.number,
          trackingNo: candidate.trackingNo,
          attemptId: claim.attemptId,
          testRequestGuid: claim.testRequestGuid,
        },
      },
    });
  });
  return receipt;
}

async function finalizeAccepted(db, candidate, claim, result, kind) {
  const finishedAt = new Date().toISOString();
  const receipt = await writeReceipt({
    kind: "x-express-production-replay",
    state: "ANNOUNCED",
    replayKind: kind,
    order: candidate.order.number,
    shipmentId: candidate.id,
    trackingNo: candidate.trackingNo,
    attemptId: claim.attemptId,
    testRequestGuid: claim.testRequestGuid,
    productionRequestGuid: result.requestGuid,
    httpStatus: result.status,
    createdAt: finishedAt,
  });
  const raw = {
    ...claim.claimedRaw,
    createOrder: result.raw,
    xExpressAnnouncement: {
      state: "ANNOUNCED",
      environment: "production",
      announcedAt: finishedAt,
      requestGuid: result.requestGuid,
    },
    xExpressProductionReplay: {
      ...record(claim.claimedRaw.xExpressProductionReplay),
      state: "ANNOUNCED",
      finishedAt,
      productionRequestGuid: result.requestGuid,
    },
  };
  await db.$transaction(async (tx) => {
    const updated = await tx.shipment.updateMany({
      where: {
        id: candidate.id,
        providerShipmentId: claim.testRequestGuid,
        providerStatusCode: CLAIMED_STATUS,
      },
      data: {
        providerShipmentId: result.requestGuid,
        providerStatusCode: ANNOUNCED_STATUS,
        syncError: null,
        rawCreateResponse: raw,
      },
    });
    if (updated.count !== 1) {
      throw new GuardError(
        `Provider je prihvatio ${candidate.order.number}, ali DB update nije uspeo. NE PONAVLJATI; receipt: ${receipt}`,
      );
    }
    await tx.shipmentEvent.create({
      data: {
        shipmentId: candidate.id,
        status: "CREATED",
        message: "X Express produkcija je prihvatila ponovljenu najavu pošiljke",
        raw: result.raw,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "xExpress.productionReplay.accepted",
        entity: "Shipment",
        entityId: candidate.id,
        diff: {
          replayKind: kind,
          orderNumber: candidate.order.number,
          trackingNo: candidate.trackingNo,
          attemptId: claim.attemptId,
          testRequestGuid: claim.testRequestGuid,
          productionRequestGuid: result.requestGuid,
        },
      },
    });
  });
  return receipt;
}

async function replayOne(db, cfg, candidate, kind) {
  const payload = payloadFor(candidate);
  const claim = await claimCandidate(db, candidate, kind);
  let result;
  try {
    result = await providerPost(cfg, payload);
  } catch (error) {
    const receipt = await markUncertain(
      db,
      candidate,
      claim,
      error,
      error instanceof ProviderRejectedError ? error.raw : error?.providerRaw,
    );
    throw new GuardError(
      `${candidate.order.number}: slanje je zaustavljeno (${error.message}). NE PONAVLJATI bez provere. Receipt: ${receipt}`,
    );
  }
  const receipt = await finalizeAccepted(db, candidate, claim, result, kind);
  return {
    order: candidate.order.number,
    trackingNo: candidate.trackingNo,
    productionRequestGuid: result.requestGuid,
    receipt,
  };
}

async function storeNikoConfirmation(db, canary, orderCode) {
  if (!isXExpressOrderCode(orderCode)) {
    throw new GuardError("Nikov produkcioni broj naloga nije u očekivanom formatu.");
  }
  const replay = replayFor(canary);
  if (canary.providerOrderId === orderCode && replay.nikoOrderCode === orderCode) {
    return;
  }
  if (canary.providerOrderId && canary.providerOrderId !== orderCode) {
    throw new GuardError(
      `Canary već ima drugi providerOrderId: ${canary.providerOrderId}.`,
    );
  }
  const confirmedAt = new Date().toISOString();
  const raw = record(canary.rawCreateResponse);
  const updatedRaw = {
    ...raw,
    xExpressProductionReplay: {
      ...replay,
      nikoConfirmedAt: confirmedAt,
      nikoOrderCode: orderCode,
    },
  };
  await db.$transaction(async (tx) => {
    const updated = await tx.shipment.updateMany({
      where: {
        id: canary.id,
        providerShipmentId: replay.productionRequestGuid,
        providerStatusCode: ANNOUNCED_STATUS,
        providerOrderId: null,
      },
      data: {
        providerOrderId: orderCode,
        rawCreateResponse: updatedRaw,
      },
    });
    if (updated.count !== 1) {
      throw new GuardError("Nikova canary potvrda nije upisana; slanje 44 je blokirano.");
    }
    await tx.shipmentEvent.create({
      data: {
        shipmentId: canary.id,
        status: "CREATED",
        message: `X Express produkcija je ručno potvrdila nalog ${orderCode}`,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "xExpress.productionReplay.nikoConfirmed",
        entity: "Shipment",
        entityId: canary.id,
        diff: {
          orderNumber: canary.order.number,
          trackingNo: canary.trackingNo,
          productionRequestGuid: replay.productionRequestGuid,
          providerOrderId: orderCode,
        },
      },
    });
  });
}

function requireExecution(options, expectedConfirmation) {
  if (options.execute !== true || options.confirm !== expectedConfirmation) {
    throw new GuardError(
      `Slanje je blokirano. Potrebni su --execute --confirm ${expectedConfirmation}`,
    );
  }
}

async function runCommand(command, options) {
  loadEnvConfig(PROJECT_ROOT, false, console);
  const db = createDb();
  try {
    const candidates = await loadCandidates(db);
    if (command === "audit") {
      console.log(JSON.stringify(auditSummary(candidates), null, 2));
      return;
    }

    if (command === "canary") {
      requireExecution(options, CANARY_CONFIRMATION);
      const cfg = requireProductionConfig();
      const candidate = candidates.find((item) => item.order.number === MANIFEST.canaryOrder);
      if (!candidate) throw new GuardError("Canary nalog nije pronađen.");
      const result = await replayOne(db, cfg, candidate, "CANARY");
      console.log(JSON.stringify({ ok: true, canary: result }, null, 2));
      return;
    }

    if (command === "remaining") {
      requireExecution(options, REMAINING_CONFIRMATION);
      const cfg = requireProductionConfig();
      const canary = candidates.find((item) => item.order.number === MANIFEST.canaryOrder);
      const canaryReplay = replayFor(canary);
      if (
        canaryReplay.state !== "ANNOUNCED" ||
        !options["niko-confirmed-guid"] ||
        options["niko-confirmed-guid"] !== canaryReplay.productionRequestGuid
      ) {
        throw new GuardError(
          "Niko potvrda mora sadržati tačan produkcioni canary requestGuid.",
        );
      }
      await storeNikoConfirmation(
        db,
        canary,
        options["niko-confirmed-order-code"],
      );
      const unexpected = candidates.filter(
        (item) => item.id !== canary.id && stateOf(item) !== "TEST_ANNOUNCED",
      );
      if (unexpected.length) {
        throw new GuardError(
          `Preostalih 44 nisu u čistom početnom stanju: ${unexpected
            .map((item) => `${item.order.number}:${stateOf(item)}`)
            .join(", ")}`,
        );
      }
      const remaining = candidates.filter((item) => item.id !== canary.id);
      if (remaining.length !== 44) throw new GuardError("Očekivana su tačno 44 preostala naloga.");
      const accepted = [];
      for (const candidate of remaining) {
        const result = await replayOne(db, cfg, candidate, "REMAINING");
        accepted.push(result);
        console.log(
          JSON.stringify({ progress: `${accepted.length}/44`, ...result }),
        );
      }
      console.log(JSON.stringify({ ok: true, accepted: accepted.length }, null, 2));
      return;
    }

    throw new GuardError("Komanda mora biti audit, canary ili remaining.");
  } finally {
    await db.$disconnect();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { command, options } = parseArgs(process.argv.slice(2));
  runCommand(command, options).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
