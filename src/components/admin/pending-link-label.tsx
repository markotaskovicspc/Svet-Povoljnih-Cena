"use client";

import { useLinkStatus } from "next/link";

export function PendingLinkLabel({
  idle,
  pending: pendingLabel,
}: {
  idle: string;
  pending: string;
}) {
  const { pending } = useLinkStatus();

  return (
    <span aria-live="polite">{pending ? pendingLabel : idle}</span>
  );
}
