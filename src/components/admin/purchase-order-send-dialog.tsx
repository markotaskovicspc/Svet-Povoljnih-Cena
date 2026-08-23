"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EMPTY_ADMIN_ACTION_STATE,
  type AdminActionState,
} from "@/lib/admin/action-state";
import { cn } from "@/lib/utils";

type SendAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export function PurchaseOrderSendDialog({
  action,
  orderId,
  orderNumber,
  supplierName,
  supplierEmail,
  sender,
  subject,
  emailHtml,
  attachmentFilename,
  attachmentHref,
  sendDateLabel,
  blockers,
  warnings,
}: {
  action: SendAction;
  orderId: string;
  orderNumber: string;
  supplierName: string | null;
  supplierEmail: string | null;
  sender: string;
  subject: string;
  emailHtml: string;
  attachmentFilename: string;
  attachmentHref: string;
  sendDateLabel: string;
  blockers: string[];
  warnings: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [state, formAction, pending] = useActionState(
    action,
    EMPTY_ADMIN_ACTION_STATE,
  );
  const canSend = blockers.length === 0;

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Pošalji dobavljaču
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!pending) setOpen(nextOpen);
        }}
      >
        <DialogContent
          className="h-[min(92dvh,920px)] w-[calc(100vw-2rem)] !max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:!max-w-6xl"
          showCloseButton={false}
        >
          <DialogHeader className="border-b px-5 py-4 sm:px-6">
            <DialogTitle>Pregled pre slanja · {orderNumber}</DialogTitle>
            <DialogDescription>
              Ništa se ne šalje dok ne izaberete „Potvrdi i pošalji“.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(280px,0.36fr)_minmax(0,0.64fr)] lg:overflow-hidden sm:p-6">
            <div className="space-y-4 lg:overflow-y-auto lg:pr-1">
              <section className="rounded-xl border bg-muted/25 p-4">
                <h3 className="mb-3 font-medium text-ink-900">Podaci poruke</h3>
                <dl className="grid gap-3 text-sm">
                  <MessageDetail label="Od" value={sender} />
                  <MessageDetail
                    label="Za"
                    value={
                      supplierEmail
                        ? `${supplierName ?? "Dobavljač"} <${supplierEmail}>`
                        : "Kontakt email nije unet"
                    }
                    danger={!supplierEmail}
                  />
                  <MessageDetail label="Naslov" value={subject} />
                  <MessageDetail
                    label="Datum porudžbenice u prilogu"
                    value={sendDateLabel}
                  />
                </dl>
              </section>

              {blockers.length ? (
                <section
                  role="alert"
                  className="rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-semibold">Slanje još nije moguće:</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                  {!supplierEmail ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href="/admin/erp/dobavljaci"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex font-medium underline underline-offset-4"
                      >
                        Otvori podatke dobavljača
                      </Link>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending || refreshing}
                        onClick={() => {
                          startRefresh(() => router.refresh());
                        }}
                      >
                        {refreshing ? "Osvežavanje…" : "Osveži podatke"}
                      </Button>
                    </div>
                  ) : null}
                </section>
              ) : (
                <p
                  role="status"
                  className="rounded-xl border border-success/25 bg-success/10 p-4 text-sm text-success"
                >
                  Primalac i obavezni podaci su spremni za slanje.
                </p>
              )}

              {warnings.length ? (
                <section className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                  <p className="font-semibold">Upozorenje:</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <a
                href={attachmentHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border bg-background p-4 transition hover:bg-muted"
              >
                <span className="rounded-md bg-destructive px-2 py-2 text-xs font-bold text-white">
                  PDF
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">
                    {attachmentFilename}
                  </span>
                  <span className="block text-xs text-ink-500">
                    Otvori tačan prilog koji će biti poslat
                  </span>
                </span>
              </a>

              {state.message ? (
                <p
                  role={state.ok ? "status" : "alert"}
                  className={cn(
                    "rounded-xl border p-4 text-sm",
                    state.ok
                      ? "border-success/25 bg-success/10 text-success"
                      : "border-destructive/25 bg-destructive/10 text-destructive",
                  )}
                >
                  {state.message}
                </p>
              ) : null}
            </div>

            <section className="min-h-[520px] overflow-hidden rounded-xl border bg-white lg:min-h-0">
              <iframe
                title={`Email pregled porudžbenice ${orderNumber}`}
                srcDoc={emailHtml}
                sandbox=""
                referrerPolicy="no-referrer"
                className="h-full min-h-[520px] w-full bg-white"
              />
            </section>
          </div>

          <DialogFooter className="m-0 rounded-none px-5 py-4 sm:px-6">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Odustani
            </Button>
            <form action={formAction}>
              <input type="hidden" name="poId" value={orderId} />
              <Button type="submit" disabled={!canSend || pending}>
                {pending ? "Slanje…" : "Potvrdi i pošalji"}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MessageDetail({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </dt>
      <dd className={cn("mt-1 break-words text-ink-900", danger && "font-medium text-destructive")}>
        {value}
      </dd>
    </div>
  );
}
