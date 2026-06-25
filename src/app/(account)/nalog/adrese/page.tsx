import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MapPin, Plus, Star, Trash2 } from "lucide-react";
import {
  addressSchema,
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  updateAddress,
  type AddressInput,
} from "@/lib/api/addresses";
import { requireUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Adrese",
  description: "Upravljanje adresama za isporuku.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function requiredText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function addressInputFromForm(formData: FormData): AddressInput | null {
  const parsed = addressSchema.safeParse({
    label: optionalText(formData.get("label")),
    firstName: requiredText(formData.get("firstName")),
    lastName: requiredText(formData.get("lastName")),
    phone: requiredText(formData.get("phone")),
    street: requiredText(formData.get("street")),
    city: requiredText(formData.get("city")),
    postalCode: requiredText(formData.get("postalCode")),
    country: "RS",
    companyName: optionalText(formData.get("companyName")),
    pib: optionalText(formData.get("pib")),
    isDefault:
      formData.get("isDefault") === "on" ||
      formData.get("isDefault") === "true",
  });

  return parsed.success ? parsed.data : null;
}

async function createAddressAction(formData: FormData) {
  "use server";

  const user = await requireUser("/nalog/adrese");
  const input = addressInputFromForm(formData);
  if (!input) redirect("/nalog/adrese?error=invalid");

  await createAddress(user.id, input);
  revalidatePath("/nalog/adrese");
}

async function deleteAddressAction(formData: FormData) {
  "use server";

  const user = await requireUser("/nalog/adrese");
  const id = requiredText(formData.get("id"));
  if (id) await deleteAddress(user.id, id);
  revalidatePath("/nalog/adrese");
}

async function setDefaultAddressAction(formData: FormData) {
  "use server";

  const user = await requireUser("/nalog/adrese");
  const id = requiredText(formData.get("id"));
  if (!id) return;

  const existing = await getAddress(user.id, id);
  if (!existing) return;

  await updateAddress(user.id, id, {
    label: existing.label ?? undefined,
    firstName: existing.firstName,
    lastName: existing.lastName,
    phone: existing.phone,
    street: existing.street,
    city: existing.city,
    postalCode: existing.postalCode,
    country: existing.country,
    companyName: existing.companyName ?? undefined,
    pib: existing.pib ?? undefined,
    isDefault: true,
  });
  revalidatePath("/nalog/adrese");
}

export default async function AccountAddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser("/nalog/adrese");
  const [{ error }, addresses] = await Promise.all([
    searchParams,
    listAddresses(user.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-[var(--container-page)] px-4 py-10 md:px-6 md:py-14">
      <div className="flex flex-col gap-3 border-b border-border/70 pb-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-muted-bg text-walnut">
            <MapPin className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-4xl text-ink-900 md:text-5xl">
              Adrese
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600">
              Sačuvajte podatke za isporuku da checkout bude brži.
            </p>
          </div>
        </div>
        {error === "invalid" ? (
          <p role="alert" className="rounded-md bg-action/10 px-3 py-2 text-sm text-action">
            Proverite obavezna polja. Poštanski broj mora imati 5 cifara, a PIB 9 cifara ako ga unosite.
          </p>
        ) : null}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-lg border border-border/70 bg-surface p-5">
          <h2 className="font-display text-2xl text-ink-900">Nova adresa</h2>
          <form action={createAddressAction} className="mt-5 grid gap-4">
            <Field name="label" label="Naziv adrese" placeholder="Kuća, posao..." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="firstName" label="Ime" autoComplete="given-name" required />
              <Field name="lastName" label="Prezime" autoComplete="family-name" required />
            </div>
            <Field name="phone" label="Telefon" autoComplete="tel" required />
            <Field name="street" label="Ulica i broj" autoComplete="street-address" required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="postalCode" label="Poštanski broj" inputMode="numeric" maxLength={5} required />
              <Field name="city" label="Grad" autoComplete="address-level2" required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="companyName" label="Naziv firme" autoComplete="organization" />
              <Field name="pib" label="PIB" inputMode="numeric" maxLength={9} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                name="isDefault"
                className="size-4 rounded border-border text-walnut"
              />
              Postavi kao podrazumevanu adresu
            </label>
            <Button type="submit" size="lg" className="w-full gap-2">
              <Plus className="size-4" aria-hidden />
              Sačuvaj adresu
            </Button>
          </form>
        </section>

        <section className="rounded-lg border border-border/70 bg-surface p-5">
          <h2 className="font-display text-2xl text-ink-900">Sačuvane adrese</h2>
          {addresses.length ? (
            <div className="mt-5 grid gap-3">
              {addresses.map((address) => (
                <article
                  key={address.id}
                  className="rounded-lg border border-border/70 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink-900">
                          {address.label || "Adresa za isporuku"}
                        </h3>
                        {address.isDefault ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted-bg px-2 py-1 text-xs font-medium text-walnut">
                            <Star className="size-3 fill-current" aria-hidden />
                            Podrazumevana
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-ink-700">
                        {address.firstName} {address.lastName}
                        <br />
                        {address.street}
                        <br />
                        {address.postalCode} {address.city}, {address.country}
                        <br />
                        {address.phone}
                      </p>
                      {address.companyName || address.pib ? (
                        <p className="mt-2 text-xs text-ink-500">
                          {[address.companyName, address.pib ? `PIB ${address.pib}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {!address.isDefault ? (
                        <form action={setDefaultAddressAction}>
                          <input type="hidden" name="id" value={address.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Postavi
                          </Button>
                        </form>
                      ) : null}
                      <form action={deleteAddressAction}>
                        <input type="hidden" name="id" value={address.id} />
                        <Button
                          type="submit"
                          variant="destructive"
                          size="sm"
                          className="gap-1"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          Obriši
                        </Button>
                      </form>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-border bg-muted-bg/40 px-5 py-10 text-center">
              <MapPin className="mx-auto size-8 text-ink-300" aria-hidden />
              <p className="mt-3 font-medium text-ink-900">Još nema sačuvanih adresa</p>
              <p className="mt-1 text-sm text-ink-500">
                Prva adresa koju dodate automatski postaje podrazumevana.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={String(props.name)}>{label}</Label>
      <Input id={String(props.name)} className="h-11 bg-white" {...props} />
    </div>
  );
}
