import "server-only";
import type { Prisma } from "@prisma/client";

/** Explicit account actions are separate from default-false legacy columns. */
export async function recordPhonePreferences(tx: Prisma.TransactionClient, userId: string, channels: { sms?: boolean; viber?: boolean }) {
  const data = (["sms", "viber"] as const).flatMap(channel => channels[channel] === undefined ? [] : [{
    action: `messaging.${channel}.${channels[channel] ? "enabled" : "disabled"}`,
    entity: "User", entityId: userId,
    diff: { channel: channel.toUpperCase(), enabled: channels[channel], source: "account-settings" },
  }]);
  if (data.length) await tx.auditLog.createMany({ data });
}
