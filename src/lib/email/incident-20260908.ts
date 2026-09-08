import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getEmailConfig } from "./config";
import { dispatch } from "./transport";
import { isEmailSuppressed } from "./tracking";

const KIND = "checkout_incident_20260908";
const APPROVED = new Set([
  "74896428539d65cc68288ed95489f10dc3f6cc261573661390eede904cf596a3",
  "c07a25752f0d77f2d86dcdfefee70a4c6d9bc28863ed9710061679456e034f5a",
  "6afc9ef88fe2920601c45268b75d2c13b4cb24538d38dbee5317a7e6966ff016",
  "1fd9b4d2e7911fd7ed10b9eef3cc4328e5fe03de3df17078794ff778070c8d02",
  "be0fa8add01202bba3ac8b8ce5bc84fde0b45a55a9ca83cca7930b0455803edc",
  "511cfc2943ccfb3a3bc2a3f4459d5b7eec623557490cbcd4c50dcc3912d94137",
  "96938f891b5f46d9f77365a38f0579b034ffd2e3101957eab426cc9b6cca9d66",
]);
export const INCIDENT_SUBJECT = "Izvinjavamo se zbog prekida — kupovina ponovo radi";
export const INCIDENT_TEXT = `Poštovani,

Danas smo imali tehnički problem koji je mogao da spreči završetak Vaše kupovine na sajtu Svet Povoljnih Cena. Izvinjavamo se zbog neprijatnosti.

Problem je otklonjen i kupovinu sada možete da nastavite:

Nastavite kupovinu: https://www.svetpovoljnihcena.rs/checkout

Link otvorite u istom pregledaču u kojem ste započeli kupovinu. Ako se Vaša korpa ne prikaže ili Vam zatreba pomoć, odgovorite na ovaj mejl i pomoći ćemo Vam da završite porudžbinu.

Ako ste u međuvremenu već dobili potvrdu porudžbine, nema potrebe da je pravite ponovo.

Hvala na razumevanju,
Tim Svet Povoljnih Cena`;

function digest(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
function key(email: string) { return `${KIND}:${digest(email)}`; }

export function incidentSendingClosed() {
  return process.env.VERCEL_ENV !== "production" || Date.now() >= Date.parse("2026-09-09T00:00:00Z");
}

export async function incidentRecipients() {
  const sessions = await db.checkoutSession.findMany({
    where: {
      createdAt: { lte: new Date("2026-09-08T17:00:00Z") },
      lastActivityAt: { gte: new Date("2026-09-08T13:00:00Z") },
    },
    select: { guestEmail: true, user: { select: { email: true } } },
  });
  const emails = [...new Set(sessions.map(s => (s.user?.email ?? s.guestEmail ?? "").trim().toLowerCase()))]
    .filter(email => APPROVED.has(digest(email))).sort();
  return Promise.all(emails.map(async email => {
    const [order, suppressed, message] = await Promise.all([
      db.order.findFirst({
        where: { OR: [
          { guestEmail: { equals: email, mode: "insensitive" } },
          { user: { email: { equals: email, mode: "insensitive" } } },
        ] },
        select: { number: true },
      }),
      isEmailSuppressed(email),
      db.emailMessage.findUnique({ where: { idempotencyKey: key(email) },
        select: { status: true, error: true, providerMessageId: true, sentAt: true } }),
    ]);
    return { email, order: order?.number ?? null, suppressed, message };
  }));
}

/** Explicitly authorized service notice; never modifies marketing consent. */
export async function sendIncidentNotice(emailRaw: string, actorId: string) {
  const email = emailRaw.trim().toLowerCase();
  if (!APPROVED.has(digest(email))) throw new Error("Primalac nije odobren.");
  if (incidentSendingClosed()) {
    throw new Error("Slanje je zatvoreno ili nije produkcija.");
  }
  const cfg = getEmailConfig();
  if (cfg.provider === "none") throw new Error("Servis za slanje nije uključen.");
  const recipient = (await incidentRecipients()).find(r => r.email === email);
  if (!recipient || recipient.order || recipient.suppressed || recipient.message) return;

  // A unique insert is the send claim. Even FAILED/QUEUED is not automatically
  // retried: a timeout or interrupted request might have reached the provider.
  let id: string;
  try {
    const message = await db.emailMessage.create({ data: {
      kind: KIND, recipient: email, subject: INCIDENT_SUBJECT,
      provider: cfg.provider, status: "QUEUED", idempotencyKey: key(email),
      tags: { kind: KIND }, metadata: { actorId, authorizedRecipientCount: 7 },
    }, select: { id: true } });
    id = message.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:auto">${INCIDENT_TEXT.split("\n\n").map(p => `<p>${p.replaceAll("\n", "<br>")}</p>`).join("").replace("Nastavite kupovinu: https://www.svetpovoljnihcena.rs/checkout", '<a href="https://www.svetpovoljnihcena.rs/checkout">Nastavite kupovinu</a>')}</div>`;
  const result = await dispatch({
    to: email, subject: INCIDENT_SUBJECT, text: INCIDENT_TEXT, html,
    replyTo: cfg.replyTo ?? cfg.commentsNotificationTo,
    tags: { kind: KIND }, idempotencyKey: key(email),
  });
  await db.emailMessage.update({ where: { id }, data: result.ok
    ? { status: "SENT", sentAt: new Date(), providerMessageId: result.id, error: null }
    : { status: "FAILED", error: result.error },
  });
}
