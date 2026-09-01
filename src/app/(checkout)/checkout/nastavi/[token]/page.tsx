import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getActiveCartRecoveryVoucherCode,
  parseCartRecoverySnapshot,
  resolveRecoverableCartLines,
} from "@/lib/checkout/cart-recovery.server";
import { verifyCartRecoveryToken } from "@/lib/checkout/cart-recovery-token";
import { nextCartRecoverySendAt } from "@/lib/checkout/cart-recovery-policy";
import { CartRecoveryClient } from "@/components/checkout/cart-recovery-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nastavite kupovinu",
  robots: { index: false, follow: false },
};

export default async function CartRecoveryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyCartRecoveryToken(token);
  if (!payload) {
    return <RecoveryUnavailable message="Link nije ispravan ili je istekao." />;
  }
  const [session, currentUser] = await Promise.all([
    db.checkoutSession.findUnique({ where: { id: payload.sessionId } }),
    getCurrentUser(),
  ]);
  if (!session || session.status !== "ACTIVE" || session.orderId) {
    return (
      <RecoveryUnavailable message="Ova kupovina je već završena ili korpa više nije dostupna." />
    );
  }
  const loggedInForSession =
    currentUser?.userType === "customer" && currentUser.id === session.userId;
  const lines = await resolveRecoverableCartLines(
    parseCartRecoverySnapshot(session.cartSnapshot),
    loggedInForSession,
  );
  if (!lines.length) {
    return (
      <RecoveryUnavailable message="Proizvodi iz ove korpe trenutno nisu dostupni." />
    );
  }

  const clickedAt = new Date();
  await db.checkoutSession.updateMany({
    where: { id: session.id, status: "ACTIVE", orderId: null },
    data: {
      recoveryClickedAt: clickedAt,
      recoveryClickedStep: payload.step,
      lastActivityAt: clickedAt,
      recoveryNextSendAt: nextCartRecoverySendAt(
        clickedAt,
        session.recoveryStep,
      ),
    },
  });
  const voucherCode = await getActiveCartRecoveryVoucherCode(session.id);
  return <CartRecoveryClient lines={lines} voucherCode={voucherCode} />;
}

function RecoveryUnavailable({ message }: { message: string }) {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4 py-12">
      <section className="bg-surface ring-border/60 w-full max-w-lg rounded-2xl p-8 text-center shadow-soft-2 ring-1">
        <h1 className="font-display text-2xl text-ink-900">
          Korpu nije moguće obnoviti
        </h1>
        <p className="mt-2 text-sm text-ink-500">{message}</p>
        <Link
          href="/"
          className="bg-ink-900 mt-5 inline-flex rounded-full px-5 py-2.5 text-sm font-medium text-white"
        >
          Pogledajte ponudu
        </Link>
      </section>
    </main>
  );
}
