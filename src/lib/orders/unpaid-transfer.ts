/**
 * Predračuni bez uplate (Marko, 14.11.2026): kupac sa uplatom na račun dobija
 * podsetnik posle 3 dana; porudžbina se automatski otkazuje posle 10 dana,
 * ali nikad ranije od 3 dana posle poslatog podsetnika.
 */
export const UNPAID_TRANSFER_REMINDER_DAYS = 3;
export const UNPAID_TRANSFER_CANCEL_DAYS = 10;
const DAY = 24 * 60 * 60 * 1000;

export const unpaidTransferReminderKey = (orderId: string) => `unpaid-transfer-reminder:${orderId}`;
export const unpaidTransferCancelKey = (orderId: string) => `unpaid-transfer-cancel:${orderId}`;

export function unpaidTransferReminderBefore(now: Date) {
  return new Date(now.getTime() - UNPAID_TRANSFER_REMINDER_DAYS * DAY);
}

export function unpaidTransferCancelBefore(now: Date) {
  return new Date(now.getTime() - UNPAID_TRANSFER_CANCEL_DAYS * DAY);
}

/** Datum do kog uplata mora da stigne, prikazan u podsetniku. */
export function unpaidTransferDeadline(createdAt: Date, remindedAt: Date) {
  const byCreation = createdAt.getTime() + UNPAID_TRANSFER_CANCEL_DAYS * DAY;
  const byReminder = remindedAt.getTime() + UNPAID_TRANSFER_REMINDER_DAYS * DAY;
  return new Date(Math.max(byCreation, byReminder));
}

export function isTransferPaid(statuses: string[]) {
  return statuses.some((status) => status === "PAID" || status === "AUTHORIZED" || status === "PARTIAL_REFUND");
}

export function shouldCancelUnpaidTransfer(input: {
  createdAt: Date;
  reminderCompletedAt: Date | null;
  now: Date;
}) {
  if (!input.reminderCompletedAt) return false;
  return (
    input.createdAt <= unpaidTransferCancelBefore(input.now) &&
    input.reminderCompletedAt <= unpaidTransferReminderBefore(input.now)
  );
}
