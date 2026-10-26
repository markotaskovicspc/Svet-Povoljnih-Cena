import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { requireSefConfig } from "@/lib/sef/config";
import { readInvoiceXml } from "@/lib/sef/ubl";
import { getSefHealthSnapshot } from "@/lib/admin/system-status";
import { eotpremnicaHealth } from "@/lib/eotpremnica/client";
import { PageHeader } from "@/components/admin/page-header";
import { SefForms, SefCourierAttachment, SefStatusForm } from "./forms";
export const dynamic = "force-dynamic";
export const metadata = { title: "SEF fakture · ERP", robots: { index: false, follow: false } };
const money = (n: unknown) => Number(n).toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const labels: Record<string, string> = { DOWNLOADED: "Preuzeto", DRAFT: "Nacrt", SUBMITTED: "Predato SEF-u", SENDING: "Slanje u toku", ERROR: "Odbijeno / greška", UNKNOWN: "Proveriti ishod na SEF-u", Approved: "Prihvaćena na SEF-u", Rejected: "Odbijena na SEF-u", Sent: "Poslata", Cancelled: "Otkazana", Storno: "Stornirana", Seen: "Pregledana" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminAction(["OPS"], "/admin/erp/sef");
  let environment: string | null = null;
  try { environment = requireSefConfig().environment; } catch { /* readiness below explains configuration */ }
  const search = await searchParams;
  const value = (key: string) => typeof search[key] === "string" ? search[key] as string : "";
  const page = Math.min(1000, Math.max(1, Math.floor(Number(value("page")) || 1)));
  const direction = value("direction") === "OUT" ? "OUT" : "IN";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" }).format(new Date());
  const date = (v: string, end = false) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v + (end ? "T23:59:59.999Z" : "T00:00:00Z")) : undefined;
  const health = await getSefHealthSnapshot();
  const eotHealth = await eotpremnicaHealth();
  const docs = environment ? await db.sefDocument.findMany({ where: { environment, direction, issueDate: { gte: date(value("from")), lte: date(value("to"), true) }, ...(value("pib") ? { supplierPib: value("pib") } : {}) }, orderBy: [{ issueDate: "desc" }, { id: "desc" }], take: 51, skip: (page - 1) * 50 }) : [];
  const recentJobs = await db.backgroundJob.findMany({ where: { kind: { in: ["SEF_INBOX_DOWNLOAD", "SEF_INBOX_DISCOVER"] }, status: { in: ["QUEUED", "RETRY", "RUNNING", "FAILED"] } }, select: { id: true, status: true, lastError: true }, take: 10, orderBy: { updatedAt: "desc" } });
  const href = (next: number) => { const params = new URLSearchParams({ direction, page: String(next) }); for (const k of ["from", "to", "pib"]) if (value(k)) params.set(k, value(k)); return `/admin/erp/sef?${params}`; };
  return <><PageHeader title="SEF fakture" description="Ulazni računi, kurirske specifikacije i fakture za firme." crumbs={[{ href: "/admin", label: "Admin" }, { label: "SEF fakture" }]}/><div className="space-y-6 px-4 py-6 md:px-8"><p role="status">{health.ok ? "Veza radi. " : "Provera veze: "}{health.message}</p><p role="status">{eotHealth.message}</p><SefForms today={today}/>
  <div className="flex gap-4"><Link className="underline" href="/admin/erp/kurirski-obracun">Kurirski obračun</Link><Link className="underline" href="/admin/erp/otpremnice">eOtpremnice</Link></div>
  {recentJobs.length > 0 && <section><h2 className="font-semibold">Preuzimanje računa</h2>{recentJobs.map(job => <p key={job.id}>{job.status === "FAILED" ? "Preuzimanje nije završeno. Proverite vezu i ponovite period." : "Preuzimanje je na čekanju ili u toku."}</p>)}</section>}
  <form className="flex flex-wrap gap-3"><select name="direction" defaultValue={direction} aria-label="Vrsta faktura"><option value="IN">Ulazne fakture</option><option value="OUT">Izlazne fakture</option></select><input type="date" name="from" aria-label="Od" defaultValue={value("from")}/><input type="date" name="to" aria-label="Do" defaultValue={value("to")}/><input name="pib" aria-label="PIB dobavljača" placeholder="PIB dobavljača" defaultValue={value("pib")}/><button>Primeni</button></form>
  {docs.slice(0, 50).map(doc => {
    let attachments: ReturnType<typeof readInvoiceXml>["attachments"] = [];
    try { attachments = readInvoiceXml(doc.xml).attachments; } catch { /* imported documents validated at boundary */ }
    return <section className="space-y-3 rounded-xl border border-border p-4" key={doc.id}><h2 className="font-semibold">{doc.number} · {labels[doc.status] || doc.status}</h2><p>{doc.issueDate.toISOString().slice(0, 10)} · {doc.direction === "IN" ? doc.supplierName : doc.customerName} · PIB {doc.direction === "IN" ? doc.supplierPib : doc.customerPib}</p><p>Bez PDV-a {money(doc.net)} · PDV {money(doc.vat)} · Ukupno {money(doc.gross)} {doc.currency}</p>{doc.remoteId && <p>SEF ID {doc.remoteId}</p>}{doc.direction === "OUT" && doc.environment === "production" && doc.sentAt && !doc.inventoryPostedAt && <p role="alert">Faktura je poslata; knjiženje lagera čeka proveru. Pritisnite proveru statusa.</p>}{(doc.remoteId || ["UNKNOWN", "SENDING"].includes(doc.status)) && <SefStatusForm id={doc.id} unknown={!doc.remoteId}/>}{doc.error && <p role="alert">{doc.error}</p>}{doc.orderId && <Link className="underline" href={`/admin/erp/prodajni-nalozi/${doc.orderId}`}>Porudžbina</Link>}<p><a className="underline" href={`/api/admin/sef/${doc.id}/download`}>Preuzmi originalni XML</a></p>{attachments.map(a => <div key={a.index}><a className="underline" href={`/api/admin/sef/${doc.id}/download?attachment=${a.index}`}>{a.filename}</a>{/\.(csv|xlsx)$/i.test(a.filename) && doc.direction === "IN" && <SefCourierAttachment id={doc.id} index={a.index}/>}</div>)}{doc.direction === "IN" && attachments.some(a => /\.pdf$/i.test(a.filename)) && <p>PDF specifikaciju prepišite u CSV obrazac iz Kurirskog obračuna. Pregled i potvrda sprečavaju pogrešno povezivanje pošiljki.</p>}</section>;
  })}{!docs.length && <p>Nema faktura u ovom pregledu.</p>}<div className="flex gap-4">{page > 1 && <Link href={href(page - 1)}>Prethodna stranica</Link>}{docs.length > 50 && <Link href={href(page + 1)}>Sledeća stranica</Link>}</div></div></>;
}
