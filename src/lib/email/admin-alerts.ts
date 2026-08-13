import "server-only";

import { createHash } from "node:crypto";
import { BRAND } from "@/lib/brand";
import { db } from "@/lib/db";
import { trackedDispatch } from "./tracking";

export const URGENT_ADMIN_ALERT_SETTING_KEY = "alerts.urgent.lastFingerprint";
export const URGENT_ADMIN_ALERT_RECIPIENTS_SETTING_KEY =
  "alerts.urgent.recipientEmails";

type UrgentIncident = {
  type: "BACKGROUND_JOB" | "EMAIL" | "FISCAL" | "REFUND" | "SHIPMENT";
  id: string;
  label: string;
  detail: string | null;
  updatedAt: Date;
};

function compactDetail(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, 300);
}

function recipientEmails(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((email): email is string => typeof email === "string")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function urgentIncidentFingerprint(incidents: readonly UrgentIncident[]) {
  const stable = incidents
    .map((incident) => `${incident.type}:${incident.id}:${incident.updatedAt.toISOString()}`)
    .sort()
    .join("|");
  return createHash("sha256").update(stable).digest("hex");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderUrgentAlert(incidents: readonly UrgentIncident[]) {
  const adminUrl = `${BRAND.url}/admin/sistem`;
  const grouped = Array.from(
    incidents.reduce((groups, incident) => {
      const key = `${incident.label}\u0000${incident.detail ?? ""}`;
      const current = groups.get(key);
      if (current) {
        current.count += 1;
      } else {
        groups.set(key, {
          label: incident.label,
          detail: incident.detail,
          count: 1,
        });
      }
      return groups;
    }, new Map<string, { label: string; detail: string | null; count: number }>()),
  ).map(([, group]) => group);
  const rows = grouped
    .map(
      (incident) =>
        `<li><strong>${escapeHtml(incident.label)}${incident.count > 1 ? ` (${incident.count}×)` : ""}</strong>${incident.detail ? ` — ${escapeHtml(incident.detail)}` : ""}</li>`,
    )
    .join("");
  const textRows = grouped
    .map(
      (incident) =>
        `- ${incident.label}${incident.count > 1 ? ` (${incident.count}×)` : ""}${incident.detail ? ` — ${incident.detail}` : ""}`,
    )
    .join("\n");
  return {
    subject: `[HITNO] ${incidents.length} otvorenih grešaka — ${BRAND.name}`,
    html: `<h1>Potrebna je provera administratora</h1><p>Sistem trenutno beleži sledeće otvorene greške:</p><ul>${rows}</ul><p><a href="${adminUrl}">Otvori status sistema</a></p>`,
    text: `Potrebna je provera administratora.\n\n${textRows}\n\nStatus sistema: ${adminUrl}`,
  };
}

async function loadUrgentIncidents(): Promise<UrgentIncident[]> {
  const [jobs, emails, fiscalDocuments, refunds, shipments] = await Promise.all([
    db.backgroundJob.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, kind: true, lastError: true, updatedAt: true },
    }),
    db.emailMessage.findMany({
      where: { status: "FAILED", kind: { not: "urgent_admin_alert" } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, kind: true, error: true, updatedAt: true },
    }),
    db.fiscalDocument.findMany({
      where: {
        status: "FAILED",
        OR: [
          { order: { status: { not: "OTKAZANO" } } },
          { dispatchedAt: { not: null } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, kind: true, orderId: true, error: true, updatedAt: true },
    }),
    db.paymentRefund.findMany({
      where: { status: { in: ["FAILED", "NEEDS_REVIEW"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, status: true, orderId: true, error: true, updatedAt: true },
    }),
    db.shipment.findMany({
      where: { status: "FAILED", order: { status: { not: "OTKAZANO" } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, provider: true, orderId: true, syncError: true, updatedAt: true },
    }),
  ]);

  return [
    ...jobs.map((row) => ({
      type: "BACKGROUND_JOB" as const,
      id: row.id,
      label: `Pozadinski posao: ${row.kind}`,
      detail: compactDetail(row.lastError),
      updatedAt: row.updatedAt,
    })),
    ...emails.map((row) => ({
      type: "EMAIL" as const,
      id: row.id,
      label: `Slanje e-pošte: ${row.kind}`,
      detail: compactDetail(row.error),
      updatedAt: row.updatedAt,
    })),
    ...fiscalDocuments.map((row) => ({
      type: "FISCAL" as const,
      id: row.id,
      label: `Fiskalni dokument ${row.kind} za porudžbinu ${row.orderId}`,
      detail: compactDetail(row.error),
      updatedAt: row.updatedAt,
    })),
    ...refunds.map((row) => ({
      type: "REFUND" as const,
      id: row.id,
      label: `Povraćaj novca ${row.status} za porudžbinu ${row.orderId}`,
      detail: compactDetail(row.error),
      updatedAt: row.updatedAt,
    })),
    ...shipments.map((row) => ({
      type: "SHIPMENT" as const,
      id: row.id,
      label: `Pošiljka za porudžbinu ${row.orderId}${row.provider ? ` (${row.provider})` : ""}`,
      detail: compactDetail(row.syncError),
      updatedAt: row.updatedAt,
    })),
  ].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export async function processUrgentAdminAlerts() {
  const [incidents, allSuperAdmins, setting, recipientSetting] = await Promise.all([
    loadUrgentIncidents(),
    db.adminUser.findMany({
      where: { role: "SUPER", enabled: true },
      orderBy: { email: "asc" },
      select: { email: true },
    }),
    db.adminSetting.findUnique({
      where: { key: URGENT_ADMIN_ALERT_SETTING_KEY },
      select: { value: true },
    }),
    db.adminSetting.findUnique({
      where: { key: URGENT_ADMIN_ALERT_RECIPIENTS_SETTING_KEY },
      select: { value: true },
    }),
  ]);
  const allowedRecipients = new Set([
    ...recipientEmails(recipientSetting?.value),
    ...[
      process.env.SUPER_ADMIN_MARKO_EMAIL,
      process.env.SUPER_ADMIN_JOVANA_EMAIL,
    ]
      .filter((email): email is string => typeof email === "string")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ]);
  const admins = allSuperAdmins.filter(({ email }) =>
    allowedRecipients.has(email.trim().toLowerCase()),
  );
  const previousFingerprint =
    typeof setting?.value === "string" ? setting.value : null;

  if (!incidents.length) {
    if (previousFingerprint !== "clear") {
      await db.adminSetting.upsert({
        where: { key: URGENT_ADMIN_ALERT_SETTING_KEY },
        create: { key: URGENT_ADMIN_ALERT_SETTING_KEY, value: "clear" },
        update: { value: "clear" },
      });
    }
    return { scanned: 0, recipients: admins.length, sent: 0, failed: 0, skipped: 0 };
  }

  const fingerprint = urgentIncidentFingerprint(incidents);
  if (previousFingerprint === fingerprint) {
    return {
      scanned: incidents.length,
      recipients: admins.length,
      sent: 0,
      failed: 0,
      skipped: admins.length,
    };
  }
  if (!admins.length) {
    return { scanned: incidents.length, recipients: 0, sent: 0, failed: 0, skipped: 0 };
  }

  const message = renderUrgentAlert(incidents);
  const results = await Promise.all(
    admins.map(({ email }) =>
      trackedDispatch({
        kind: "urgent_admin_alert",
        to: email,
        ...message,
        idempotencyKey: `urgent-admin:${fingerprint.slice(0, 40)}:${createHash("sha256").update(email).digest("hex").slice(0, 24)}`,
        tags: { category: "urgent_admin", incident_count: String(incidents.length) },
        metadata: { fingerprint, incidentCount: incidents.length },
      }),
    ),
  );
  const sent = results.filter((result) => result.ok).length;
  const failed = results.length - sent;
  if (failed === 0) {
    await db.adminSetting.upsert({
      where: { key: URGENT_ADMIN_ALERT_SETTING_KEY },
      create: { key: URGENT_ADMIN_ALERT_SETTING_KEY, value: fingerprint },
      update: { value: fingerprint },
    });
  }
  return {
    scanned: incidents.length,
    recipients: admins.length,
    sent,
    failed,
    skipped: 0,
  };
}
