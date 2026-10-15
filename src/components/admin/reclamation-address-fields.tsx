"use client";
import { useState } from "react";
import { CityAutocomplete } from "@/components/forms/city-autocomplete";
import { Field } from "@/components/admin/field";
import type { ReclamationAddress } from "@/lib/reclamation-address";

export function ReclamationAddressFields({ initial }: { initial: ReclamationAddress }) {
  const [place, setPlace] = useState({ city: initial.shipCity, postalCode: initial.shipPostalCode, townId: initial.shipXExpressTownId });
  const fields = [["shipFirstName", "Ime"], ["shipLastName", "Prezime"], ["shipPhone", "Telefon"], ["shipStreet", "Ulica"], ["shipHouseNumber", "Kućni broj"]] as const;
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {fields.map(([name, label]) => <Field key={name} label={label}><input required name={name} type={name === "shipPhone" ? "tel" : "text"} maxLength={name === "shipHouseNumber" ? 20 : 200} defaultValue={initial[name]} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm" /></Field>)}
    <div><CityAutocomplete label="Mesto" required strictRemote autoResolveExact minChars={2} value={place.city} postalCode={place.postalCode} selectedTownId={place.townId} onValueChange={city => setPlace({ city, postalCode: "", townId: null })} onSelect={value => setPlace({ city: value.name, postalCode: value.postalCode, townId: value.townId ?? null })} />
    <input type="hidden" name="shipCity" value={place.city} /><input type="hidden" name="shipPostalCode" value={place.postalCode} /><input type="hidden" name="shipXExpressTownId" value={place.townId ?? ""} />
    <p className="mt-1 text-xs text-ink-500">Poštanski broj: {place.postalCode || "Izaberite mesto iz liste"}</p></div>
  </div>;
}
