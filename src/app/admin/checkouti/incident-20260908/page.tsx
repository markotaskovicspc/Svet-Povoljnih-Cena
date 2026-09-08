import { revalidatePath } from "next/cache";
import { requireAdminAction, logAudit } from "@/lib/admin";
import { getEmailConfig } from "@/lib/email/config";
import { incidentRecipients, incidentSendingClosed, sendIncidentNotice, INCIDENT_SUBJECT, INCIDENT_TEXT } from "@/lib/email/incident-20260908";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Servisna poruka · 8. septembar", robots: { index: false, follow: false } };

async function sendApproved() {
  "use server";
  const admin = await requireAdminAction(["SUPER"]);
  await logAudit({ actorId: admin.id, action: "checkout.incident_notice.authorized", entity: "EmailMessage", diff: { incident: "2026-09-08", approvedRecipients: 7 } });
  const recipients = await incidentRecipients();
  for (const recipient of recipients) await sendIncidentNotice(recipient.email, admin.id);
  revalidatePath("/admin/checkouti/incident-20260908");
}

export default async function IncidentPage() {
  await requireAdminAction(["SUPER"]);
  const recipients = await incidentRecipients();
  const cfg = getEmailConfig();
  const closed = incidentSendingClosed();
  return <main className="space-y-5 p-8">
    <h1 className="text-2xl font-bold">Servisna poruka — prekid 8. septembra</h1>
    <p>Samo sedam prethodno odobrenih kontakata. Kupci sa porudžbinom, potisnute adrese i već pokušane poruke se preskaču.</p>
    <p>Pošiljalac: {cfg.from} · Odgovori: {cfg.replyTo ?? cfg.commentsNotificationTo}</p>
    <h2 className="font-bold">{INCIDENT_SUBJECT}</h2>
    <pre className="whitespace-pre-wrap font-sans">{INCIDENT_TEXT}</pre>
    <table className="w-full text-left"><thead><tr><th>Email</th><th>Porudžbina</th><th>Status</th><th>ID poruke / greška</th></tr></thead>
      <tbody>{recipients.map(r => <tr key={r.email}>
        <td className="py-2">{r.email}</td><td>{r.order ?? "—"}</td>
        <td>{r.message?.status ?? (r.order ? "KUPIO — PRESKOČEN" : r.suppressed ? "POTISNUT — PRESKOČEN" : "SPREMNO")}</td>
        <td>{r.message?.providerMessageId ?? r.message?.error ?? "—"}</td>
      </tr>)}</tbody>
    </table>
    <form action={sendApproved}><button className="rounded bg-blue-800 px-4 py-2 text-white disabled:opacity-50" disabled={closed || !recipients.some(r => !r.order && !r.suppressed && !r.message)}>Pošalji odobrene poruke</button></form>
    {closed && <p>Slanje je zatvoreno.</p>}
  </main>;
}
