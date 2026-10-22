import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { withOrderReturnLock } from "@/lib/fiscal/return-lock";
import { issueFiscalRefundUnderLock } from "@/lib/fiscal/issue";
import { reclamationReturnReceiptsWhere } from "./reclamation-refund-notice.server";
import { allocateClaimRefund, normalizeRefundBankAccount, readReclamationPayoutPlan } from "./reclamation-refund";

export const claimPayoutKey = (id: string) => `reclamation-refund:${id}`;

async function claimForRefund(id: string) {
  const claim = await db.reclamation.findUnique({ where: { id }, include: { order: true } });
  if (!claim || !claim.orderItemId || claim.order.channel === "ANANAS") throw new Error("Reklamacija nema SPC fiskalnu stavku za refundaciju.");
  if (claim.decision !== "PRIHVACENA" || claim.resolution !== "POVRAT_NOVCA" || claim.status === "ODBIJENO") {
    throw new Error("Prvo prihvatite reklamaciju i izaberite povrat novca.");
  }
  return claim;
}

async function fiscalDocumentsForPayout(payoutId: string) {
  return db.fiscalDocument.findMany({
    where: { kind: "REFUND", rawRequest: { path: ["manualPaymentRefundId"], equals: payoutId } },
    include: { lines: true }, orderBy: { createdAt: "asc" },
  });
}

export async function loadReclamationRefund(id: string) {
  const [claim, payout, receipts] = await Promise.all([
    db.reclamation.findUnique({ where: { id }, select: { orderItemId: true, quantity: true, status: true } }),
    db.paymentRefund.findUnique({ where: { idempotencyKey: claimPayoutKey(id) } }),
    db.stockMovement.findMany({ where: reclamationReturnReceiptsWhere(id), select: { qty: true } }),
  ]);
  const lines = claim?.orderItemId ? await db.fiscalDocumentLine.findMany({
    where: { orderItemId: claim.orderItemId, fiscalDocument: { kind: "SALE", status: "ISSUED" } }, orderBy: { id: "asc" },
  }) : [];
  const documents = payout ? await fiscalDocumentsForPayout(payout.id) : [];
  let amount: number | null = payout ? num(payout.amount) : null;
  let problem: string | null = null;
  if (!payout && claim) {
    try { amount = allocateClaimRefund(lines, claim.quantity).amount; }
    catch (error) { problem = error instanceof Error ? error.message : String(error); }
  }
  const issued = documents.filter(doc => doc.status === "ISSUED");
  const plan = readReclamationPayoutPlan(payout?.rawRequest);
  const issuedLines = issued.flatMap(doc => doc.lines);
  const quantitiesMatch = Boolean(plan && plan.lines.every(line => issuedLines.filter(row => row.originalSaleLineId === line.id).reduce((sum, row) => sum + row.qty, 0) === line.qty)
    && issuedLines.every(row => plan.lines.some(line => line.id === row.originalSaleLineId)));
  return { payout, plan, documents, legacyResolved: claim?.status === "RESENO" && !payout,
    received: receipts.reduce((sum, row) => sum + row.qty, 0), amount, problem,
    fiscalComplete: Boolean(payout && quantitiesMatch && documents.every(doc => doc.status === "ISSUED") && issued.length && Math.round(issued.reduce((sum, doc) => sum + num(doc.totalGross), 0) * 100) === Math.round(num(payout.amount) * 100)),
  };
}

/** No transfer is executed here. This only issues the explicitly requested fiscal document. */
export async function issueReclamationRefund(input: { id: string; bankAccount: string; confirmPaid: boolean; actorId: string }) {
  const initial = await claimForRefund(input.id);
  return withOrderReturnLock(initial.orderId, async () => {
    const claim = await claimForRefund(input.id);
    const receipts = await db.stockMovement.findMany({ where: reclamationReturnReceiptsWhere(claim.id), orderBy: { createdAt: "asc" } });
    if (receipts.reduce((sum, row) => sum + row.qty, 0) < claim.quantity) throw new Error("Prvo proknjižite prijem svih komada ove reklamacije u magacin.");
    const bankAccount = normalizeRefundBankAccount(input.bankAccount);
    let payout = await db.paymentRefund.findUnique({ where: { idempotencyKey: claimPayoutKey(claim.id) } });
    let plan = readReclamationPayoutPlan(payout?.rawRequest);
    if (!payout) {
      if (!input.confirmPaid) throw new Error("Potvrdite da je kupac platio robu. ERP status uplate sam po sebi ne potvrđuje naplatu pouzeća.");
      if (claim.status === "RESENO") throw new Error("Reklamacija je već rešena. Proverite raniju isplatu pre novog zahteva.");
      const lines = await db.fiscalDocumentLine.findMany({
        where: { orderItemId: claim.orderItemId!, fiscalDocument: { kind: "SALE", status: "ISSUED" } }, orderBy: { id: "asc" },
      });
      // Reserve quantities for other unfinished claim payouts as well as issued
      // refunds. Overlapping claim records must not spend the same sale twice.
      const otherPayouts = await db.paymentRefund.findMany({ where: { orderId: claim.orderId, idempotencyKey: { startsWith: "reclamation-refund:" }, status: { not: "COMPLETED" } } });
      const reserved = new Map<string, number>();
      for (const other of otherPayouts) {
        const otherPlan = readReclamationPayoutPlan(other.rawRequest);
        if (!otherPlan) continue;
        const issued = (await fiscalDocumentsForPayout(other.id)).filter(doc => doc.status === "ISSUED").flatMap(doc => doc.lines);
        for (const line of otherPlan.lines) {
          const done = issued.filter(row => row.originalSaleLineId === line.id).reduce((sum, row) => sum + row.qty, 0);
          reserved.set(line.id, (reserved.get(line.id) ?? 0) + Math.max(0, line.qty - done));
        }
      }
      const allocation = allocateClaimRefund(lines, claim.quantity, reserved);
      plan = { reclamationId: claim.id, bankAccount, quantity: claim.quantity, lines: allocation.lines, confirmedPaidBy: input.actorId };
      payout = await db.paymentRefund.create({ data: {
        idempotencyKey: claimPayoutKey(claim.id), orderId: claim.orderId, method: "UPLATA_NA_RACUN", provider: "MANUAL", status: "PENDING",
        amount: new Prisma.Decimal(allocation.amount), actorId: input.actorId, rawRequest: plan,
        error: "Čeka fiskalnu refundaciju i potvrdu ručno izvršene uplate kupcu.",
      } });
    }
    if (!plan || plan.reclamationId !== claim.id || plan.quantity !== claim.quantity || plan.bankAccount !== bankAccount) {
      throw new Error("Sačuvani nalog se razlikuje od unetih podataka. Proverite račun kupca i količinu reklamacije pre nastavka.");
    }
    const documents = await fiscalDocumentsForPayout(payout.id);
    const issuedLines = documents.filter(doc => doc.status === "ISSUED").flatMap(doc => doc.lines);
    const quantities = Object.fromEntries(plan.lines.map(line => [line.id, line.qty - issuedLines.filter(row => row.originalSaleLineId === line.id).reduce((sum, row) => sum + row.qty, 0)]).filter(([, qty]) => Number(qty) > 0));
    if (!Object.keys(quantities).length) return { payoutId: payout.id, alreadyIssued: true };
    const result = await issueFiscalRefundUnderLock({
      fiscalLineIds: Object.keys(quantities), quantities: quantities as Record<string, number>, paymentReturnMethod: "UPLATA_NA_RACUN",
      warehouseId: receipts[0]!.warehouseId, manualPaymentRefundId: payout.id, actorId: input.actorId,
    });
    if (!result.ok) {
      await db.paymentRefund.update({ where: { id: payout.id }, data: { error: result.error } });
      throw new Error(result.error);
    }
    await db.paymentRefund.update({ where: { id: payout.id }, data: { error: "Fiskalna refundacija je izdata. Čeka potvrdu ručno izvršene uplate kupcu." } });
    return { payoutId: payout.id, alreadyIssued: false };
  });
}

export async function confirmReclamationPayout(input: { id: string; paidAt: string; reference: string; actorId: string; confirmed: boolean }) {
  const initial = await claimForRefund(input.id);
  const paidAt = new Date(input.paidAt);
  const reference = input.reference.trim();
  if (!input.confirmed || !reference || reference.length > 200 || !Number.isFinite(paidAt.getTime()) || paidAt > new Date()) {
    throw new Error("Unesite datum i referencu izvršene uplate i potvrdite da je novac stvarno poslat kupcu.");
  }
  return withOrderReturnLock(initial.orderId, async () => {
    const state = await loadReclamationRefund(input.id);
    if (!state.payout || !state.plan || !state.fiscalComplete) throw new Error("Prvo završite fiskalnu refundaciju za celu količinu ove reklamacije.");
    if (state.payout.status === "COMPLETED") return state.payout.id;
    await db.$transaction(async tx => {
      await tx.paymentRefund.update({ where: { id: state.payout!.id }, data: {
        status: "COMPLETED", completedAt: paidAt, providerRef: reference, error: null,
        rawResponse: { manuallyConfirmed: true, confirmedBy: input.actorId, confirmedAt: new Date().toISOString() },
      } });
      await tx.reclamation.update({ where: { id: input.id }, data: { status: "RESENO", resolvedAt: new Date() } });
      await tx.reclamationStatusEvent.create({ data: {
        reclamationId: input.id, status: "RESENO", actorId: input.actorId,
        note: `Fiskalna refundacija završena; ručna isplata ${num(state.payout!.amount)} RSD na račun kupca potvrđena. Referenca: ${reference}`,
      } });
    });
    return state.payout.id;
  });
}
