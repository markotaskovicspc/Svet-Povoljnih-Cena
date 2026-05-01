"use client";

import { useFormContext } from "react-hook-form";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { CheckoutFormData } from "./checkout-flow";

const ASSEMBLY_CITIES = [
  "Beograd",
  "Novi Sad",
  "Niš",
  "Kragujevac",
  "Subotica",
  "Pančevo",
  "Zrenjanin",
  "Čačak",
  "Kraljevo",
  "Leskovac",
  "Smederevo",
  "Sombor",
  "Šabac",
  "Užice",
  "Valjevo",
];

/**
 * Step 2 — Shipping data.
 * Lice toggle (Fizičko / Pravno), required fields with mask-friendly phone,
 * optional second billing address that animates open/closed.
 */
export function ShippingForm() {
  const {
    register,
    watch,
    setValue,
    formState: { errors, isSubmitted },
  } = useFormContext<CheckoutFormData>();

  const liceType = watch("shipping.liceType");
  const shipToDifferent = watch("shipToDifferent");
  const billingLice = watch("billing.liceType");

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-ink-900">
          Tip kupca
        </legend>
        <div className="bg-muted-bg ring-border/60 inline-flex w-fit rounded-full p-1 ring-1">
          {(["fizicko", "pravno"] as const).map((lt) => (
            <button
              key={lt}
              type="button"
              onClick={() => setValue("shipping.liceType", lt, { shouldDirty: true })}
              aria-pressed={liceType === lt}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none",
                "focus-visible:ring-walnut/40 focus-visible:ring-2",
                liceType === lt
                  ? "bg-surface text-ink-900 shadow-soft-1"
                  : "text-ink-700 hover:text-ink-900",
              )}
            >
              {lt === "fizicko" ? "Fizičko lice" : "Pravno lice"}
            </button>
          ))}
        </div>
      </fieldset>

      <AddressFieldset
        prefix="shipping"
        liceType={liceType}
        showSubmitErrors={isSubmitted}
        register={register}
        errors={errors}
      />

      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          className="accent-walnut size-4"
          {...register("shipToDifferent")}
        />
        Isporuka na drugu adresu?
      </label>

      <AnimatePresence initial={false}>
        {shipToDifferent ? (
          <motion.div
            key="billing"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-border/60 mt-2 flex flex-col gap-4 border-t pt-5">
              <p className="text-sm font-medium text-ink-900">
                Druga adresa za isporuku
              </p>
              <AddressFieldset
                prefix="billing"
                liceType={billingLice ?? "fizicko"}
                showSubmitErrors={isSubmitted}
                register={register}
                errors={errors}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

interface AddressFieldsetProps {
  prefix: "shipping" | "billing";
  liceType: "fizicko" | "pravno" | undefined;
  showSubmitErrors: boolean;
  register: ReturnType<typeof useFormContext<CheckoutFormData>>["register"];
  errors: ReturnType<typeof useFormContext<CheckoutFormData>>["formState"]["errors"];
}

function AddressFieldset({
  prefix,
  liceType,
  showSubmitErrors,
  register,
  errors,
}: AddressFieldsetProps) {
  const errAt = (path: string): string | undefined => {
    const seg = path.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cur: any = errors;
    for (const s of seg) cur = cur?.[s];
    return cur?.message as string | undefined;
  };
  const showError = (path: string) =>
    showSubmitErrors ? errAt(`${prefix}.${path}`) : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field
        label="Ime"
        required
        error={showError("firstName")}
        {...register(`${prefix}.firstName` as const, {
          required: "Obavezno polje",
          minLength: { value: 2, message: "Ime je prekratko" },
        })}
      />
      <Field
        label="Prezime"
        required
        error={showError("lastName")}
        {...register(`${prefix}.lastName` as const, {
          required: "Obavezno polje",
          minLength: { value: 2, message: "Prezime je prekratko" },
        })}
      />
      <Field
        label="E-pošta"
        type="email"
        required
        error={showError("email")}
        {...register(`${prefix}.email` as const, {
          required: "Obavezno polje",
          pattern: {
            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            message: "Unesite ispravnu e-poštu",
          },
        })}
      />
      <Field
        label="Telefon"
        type="tel"
        required
        placeholder="+381 6X XXX XXXX"
        error={showError("phone")}
        {...register(`${prefix}.phone` as const, {
          required: "Obavezno polje",
          pattern: {
            value: /^\+381\s?6\d(\s?\d{2,3}){2,3}$/,
            message: "Format: +381 6X XXX XXXX",
          },
        })}
      />
      <Field
        label="Adresa"
        required
        className="sm:col-span-2"
        error={showError("street")}
        {...register(`${prefix}.street` as const, {
          required: "Obavezno polje",
          minLength: { value: 3, message: "Adresa je prekratka" },
        })}
      />
      <FieldWithDatalist
        label="Grad"
        required
        listId={`${prefix}-cities`}
        options={ASSEMBLY_CITIES}
        error={showError("city")}
        {...register(`${prefix}.city` as const, {
          required: "Obavezno polje",
        })}
      />
      <Field
        label="Poštanski broj"
        required
        placeholder="11000"
        inputMode="numeric"
        error={showError("postalCode")}
        {...register(`${prefix}.postalCode` as const, {
          required: "Obavezno polje",
          pattern: { value: /^\d{5}$/, message: "5 cifara" },
        })}
      />

      {liceType === "pravno" ? (
        <>
          <Field
            label="Naziv kompanije"
            required
            className="sm:col-span-2"
            error={showError("companyName")}
            {...register(`${prefix}.companyName` as const, {
              required: "Obavezno za pravno lice",
              minLength: { value: 2, message: "Najmanje 2 karaktera" },
            })}
          />
          <Field
            label="PIB"
            required
            placeholder="123456789"
            inputMode="numeric"
            error={showError("pib")}
            {...register(`${prefix}.pib` as const, {
              required: "Obavezno za pravno lice",
              pattern: { value: /^\d{9}$/, message: "PIB ima 9 cifara" },
            })}
          />
        </>
      ) : null}
    </div>
  );
}

const Field = ({
  label,
  required,
  error,
  className,
  ...props
}: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
} & React.ComponentProps<"input">) => {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${props.name ?? ""}`;
  return (
    <label className={cn("flex flex-col gap-1.5", className)} htmlFor={id}>
      <span className="text-xs font-medium text-ink-700">
        {label}
        {required ? <span className="text-action ml-0.5">*</span> : null}
      </span>
      <input
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cn(
          "ring-border/60 focus-visible:ring-walnut/40 bg-canvas h-11 rounded-xl px-3 text-sm text-ink-900 ring-1 transition placeholder:text-ink-300",
          "focus-visible:ring-2 focus-visible:outline-none",
          error && "ring-action/60 focus-visible:ring-action/40",
        )}
        {...props}
      />
      {error ? (
        <span id={`${id}-err`} className="text-action text-[11px]">
          {error}
        </span>
      ) : null}
    </label>
  );
};

const FieldWithDatalist = ({
  label,
  required,
  error,
  listId,
  options,
  ...props
}: {
  label: string;
  required?: boolean;
  error?: string;
  listId: string;
  options: string[];
} & React.ComponentProps<"input">) => {
  return (
    <>
      <Field
        label={label}
        required={required}
        error={error}
        list={listId}
        autoComplete="off"
        {...props}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
};
