"use client";
import type { ReactNode } from "react";
import { MailIcon, PlusIcon } from "lucide-react";
import { ReclamationCustomerLink } from "@/components/admin/reclamation-customer-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Dve glavne akcije Dnevnika reklamacija, u jednom redu zaglavlja; svaka otvara svoj popup. */
export function ReclamationActionDialogs({ manualForm }: { manualForm: ReactNode }) {
  return (
    <>
      <Dialog>
        <DialogTrigger render={<Button className="h-7 w-full justify-start px-2.5 text-xs" />}>
          <MailIcon aria-hidden="true" />
          Pošalji kupcu obrazac
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg">Pošalji kupcu obrazac za reklamaciju</DialogTitle>
            <DialogDescription>
              Izaberite porudžbinu, napravite link i pošaljite ga kupcu preko mejla, Facebooka ili druge
              poruke. Kupac sam unosi problem i fotografije, a prijava stiže u ovaj dnevnik.
            </DialogDescription>
          </DialogHeader>
          <ReclamationCustomerLink embedded />
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger render={<Button variant="outline" className="h-7 w-full justify-start px-2.5 text-xs" />}>
          <PlusIcon aria-hidden="true" />
          Ručno evidentiraj
        </DialogTrigger>
        <DialogContent className="sm:max-w-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg">Ručno evidentiraj reklamaciju</DialogTitle>
            <DialogDescription>
              Za telefonsku, prodajnu ili drugu prijavu koju operater evidentira u ime kupca. Možete izabrati
              porudžbinu bez obzira na njen status, uključujući ponovne prijave već reklamiranih artikala.
            </DialogDescription>
          </DialogHeader>
          {manualForm}
        </DialogContent>
      </Dialog>
    </>
  );
}
