"use client";

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { PurchaseSuggestion } from "./purchase-suggestion";

/**
 * "Predlog kupovine" modal. Mounted globally; opens from "Pregled korpe"
 * and "Plati" actions, with products loaded from admin recommendation rules.
 */
export function CrossSellModal() {
  const router = useRouter();
  const destination = useCartUi((s) => s.suggestionDestination);
  const crossSellSku = useCartUi((s) => s.crossSellSku);
  const close = useCartUi((s) => s.closeCrossSell);
  const open = Boolean(destination || crossSellSku);

  function continueToDestination() {
    const target = destination ?? "/korpa";
    close();
    router.push(target);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto bg-surface">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-ink-900">
            Predlog kupovine
          </DialogTitle>
          <DialogDescription className="text-ink-500">
            Pre nastavka možete brzo pogledati artikle koje je admin povezao sa proizvodima iz korpe.
          </DialogDescription>
        </DialogHeader>
        <PurchaseSuggestion />
        <DialogFooter className="bg-transparent">
          <Button type="button" variant="outline" onClick={close}>
            Ostani u kupovini
          </Button>
          <Button type="button" onClick={continueToDestination}>
            Nastavi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
