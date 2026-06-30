"use client";

import { useEffect, useId, useState } from "react";
import { useFormContext } from "react-hook-form";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { CheckoutFormData } from "./checkout-flow";
import {
  CityAutocomplete,
  type CityAutocompletePlace,
} from "@/components/forms/city-autocomplete";

/**
 * Step 2 — Shipping data.
 * Lice toggle (Fizičko / Pravno), required fields with mask-friendly phone,
 * optional second billing address that animates open/closed.
 */
export function ShippingForm({
  xExpressAddressEnabled = false,
}: {
  xExpressAddressEnabled?: boolean;
}) {
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
    <div className="flex flex-col gap-4 md:gap-5 lg:gap-3">
      <fieldset className="flex flex-col gap-2.5 lg:gap-2">
        <legend className="text-sm font-medium text-ink-900">
          Tip kupca
        </legend>
        <div className="bg-muted-bg ring-border/60 inline-flex w-fit rounded-full p-1 ring-1">
          {(["fizicko", "pravno"] as const).map((lt) => (
            <button
              key={lt}
              type="button"
              onClick={() => {
                setValue("shipping.liceType", lt, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                });
                if (lt === "pravno" && liceType !== "pravno") {
                  setValue("shipping.companyName", "", { shouldDirty: false });
                  setValue("shipping.pib", "", { shouldDirty: false });
                }
              }}
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
        showSubmitErrors={isSubmitted || Boolean(errors.shipping)}
        register={register}
        setValue={setValue}
        watch={watch}
        errors={errors}
        xExpressAddressEnabled={xExpressAddressEnabled}
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
            <div className="border-border/60 mt-2 flex flex-col gap-4 border-t pt-4 lg:gap-3 lg:pt-3">
              <p className="text-sm font-medium text-ink-900">
                Druga adresa za isporuku
              </p>
              <AddressFieldset
                prefix="billing"
                liceType={billingLice ?? "fizicko"}
                showSubmitErrors={isSubmitted || Boolean(errors.billing)}
                register={register}
                setValue={setValue}
                watch={watch}
                errors={errors}
                xExpressAddressEnabled={false}
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
  setValue: ReturnType<typeof useFormContext<CheckoutFormData>>["setValue"];
  watch: ReturnType<typeof useFormContext<CheckoutFormData>>["watch"];
  errors: ReturnType<typeof useFormContext<CheckoutFormData>>["formState"]["errors"];
  xExpressAddressEnabled: boolean;
}

function AddressFieldset({
  prefix,
  liceType,
  showSubmitErrors,
  register,
  setValue,
  watch,
  errors,
  xExpressAddressEnabled,
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
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:gap-3 lg:gap-2.5">
      {liceType === "pravno" ? (
        <>
          <Field
            label="Naziv"
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
            maxLength={9}
            error={showError("pib")}
            {...register(`${prefix}.pib` as const, {
              required: "Obavezno za pravno lice",
              pattern: { value: /^\d{9}$/, message: "PIB ima 9 cifara" },
            })}
          />
        </>
      ) : null}
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
        placeholder="060123456"
        inputMode="numeric"
        maxLength={12}
        error={showError("phone")}
        {...register(`${prefix}.phone` as const, {
          required: "Obavezno polje",
          setValueAs: normalizePhone,
          pattern: {
            value: /^06\d{7,8}$/,
            message: "Unesite 9 ili 10 cifara, broj mora početi sa 06",
          },
        })}
      />
      {xExpressAddressEnabled ? (
        <>
          <XExpressStreetAutocomplete
            className="order-2 sm:col-span-2"
            townId={watch(`${prefix}.xExpressTownId` as const) ?? null}
            value={watch(`${prefix}.street` as const) ?? ""}
            error={showError("street")}
            onValueChange={(value) => {
              setValue(`${prefix}.street` as const, value, {
                shouldDirty: true,
                shouldValidate: showSubmitErrors,
              });
              setValue(`${prefix}.xExpressStreetId` as const, null, {
                shouldDirty: true,
                shouldValidate: false,
              });
            }}
            onSelect={(street) => {
              setValue(`${prefix}.street` as const, street.name, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setValue(`${prefix}.xExpressStreetId` as const, street.id, {
                shouldDirty: true,
                shouldValidate: false,
              });
            }}
          />
          <input
            type="hidden"
            {...register(`${prefix}.street` as const, {
              required: "Obavezno polje",
              minLength: { value: 3, message: "Adresa je prekratka" },
            })}
          />
        </>
      ) : (
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
      )}
      {/*
       * City + postal-code linked autocomplete (spec §32–35):
       * after ≥3 chars the user sees a list of Serbian places + postal
       * codes; selecting one auto-fills the postal-code field.
       *
       * `register` still attaches validation rules to the city field; we
       * just override the input via `setValue` on selection.
       */}
      <CityAutocomplete
        className={xExpressAddressEnabled ? "order-1" : undefined}
        required
        value={watch(`${prefix}.city` as const) ?? ""}
        error={showError("city")}
        strictRemote={xExpressAddressEnabled}
        minChars={xExpressAddressEnabled ? 2 : 3}
        onValueChange={(v) => {
          setValue(`${prefix}.city` as const, v, {
            shouldDirty: true,
            shouldValidate: showSubmitErrors,
          });
          if (xExpressAddressEnabled) {
            setValue(`${prefix}.xExpressTownId` as const, null, {
              shouldDirty: true,
              shouldValidate: true,
            });
            setValue(`${prefix}.xExpressStreetId` as const, null, {
              shouldDirty: true,
              shouldValidate: false,
            });
          }
        }}
        onSelect={(place: CityAutocompletePlace) => {
          setValue(`${prefix}.city` as const, place.name, {
            shouldDirty: true,
            shouldValidate: true,
          });
          setValue(`${prefix}.postalCode` as const, place.postalCode, {
            shouldDirty: true,
            shouldValidate: true,
          });
          if (xExpressAddressEnabled) {
            setValue(`${prefix}.xExpressTownId` as const, place.townId ?? null, {
              shouldDirty: true,
              shouldValidate: true,
            });
            setValue(`${prefix}.xExpressStreetId` as const, null, {
              shouldDirty: true,
              shouldValidate: false,
            });
          }
        }}
      />
      {/* Hidden `register` keeps the city field in the form schema so
          required/validation rules still fire on submit. */}
      <input
        type="hidden"
        {...register(`${prefix}.city` as const, {
          required: "Obavezno polje",
        })}
      />
      <input
        type="hidden"
        {...register(`${prefix}.xExpressTownId` as const, {
          valueAsNumber: true,
          validate: (value) =>
            !xExpressAddressEnabled ||
            (Number.isInteger(Number(value)) && Number(value) > 0) ||
            "Izaberite mesto iz liste",
        })}
      />
      <input
        type="hidden"
        {...register(`${prefix}.xExpressStreetId` as const, {
          valueAsNumber: true,
        })}
      />
      <Field
        label="Poštanski broj"
        required
        className={xExpressAddressEnabled ? "order-3" : undefined}
        placeholder="11000"
        inputMode="numeric"
        error={showError("postalCode")}
        {...register(`${prefix}.postalCode` as const, {
          required: "Obavezno polje",
          pattern: { value: /^\d{5}$/, message: "5 cifara" },
        })}
      />
    </div>
  );
}

type XExpressStreetSuggestion = {
  id: number;
  streetId?: number | null;
  name: string;
  simpleName?: string | null;
  official: boolean;
};

function XExpressStreetAutocomplete({
  townId,
  value,
  onValueChange,
  onSelect,
  error,
  className,
}: {
  townId: number | null;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (street: XExpressStreetSuggestion) => void;
  error?: string;
  className?: string;
}) {
  const id = useId();
  const inputId = `street-${id}`;
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    key: string;
    items: XExpressStreetSuggestion[];
  }>({ key: "", items: [] });
  const query = value.trim();
  const resultKey = townId && query.length >= 2 ? `${townId}:${query}` : "";

  useEffect(() => {
    if (!townId || query.length < 2) {
      return;
    }
    const controller = new AbortController();
    const key = `${townId}:${query}`;
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/x-express/streets?townId=${townId}&q=${encodeURIComponent(query)}&limit=8`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { items?: XExpressStreetSuggestion[] };
        setResult({ key, items: json.items ?? [] });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult({ key, items: [] });
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, townId]);

  const items = result.key === resultKey ? result.items : [];
  const showPanel = open && items.length > 0 && Boolean(resultKey);

  return (
    <label className={cn("relative flex flex-col gap-1.5 lg:gap-1", className)} htmlFor={inputId}>
      <span className="text-xs font-medium text-ink-700">
        Adresa<span className="text-action ml-0.5">*</span>
      </span>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="street-address"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${inputId}-err` : undefined}
        placeholder={townId ? "Ulica i broj" : "Prvo izaberite mesto"}
        className={cn(
          "ring-border/60 focus-visible:ring-walnut/40 bg-canvas h-10 w-full rounded-xl px-3 text-base text-ink-900 ring-1 transition placeholder:text-ink-300 md:h-11 md:text-sm lg:h-10",
          "focus-visible:ring-2 focus-visible:outline-none",
          error && "ring-action/60 focus-visible:ring-action/40",
        )}
      />
      {showPanel ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-30 max-h-[260px] overflow-y-auto rounded-2xl border border-border bg-surface py-1 shadow-soft-4"
        >
          {items.map((street) => (
            <li key={street.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(street);
                  setOpen(false);
                }}
                className="hover:bg-muted-bg/60 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-ink-700 transition"
              >
                <span className="truncate">{street.name}</span>
                {street.official ? (
                  <span className="text-[11px] font-medium text-ink-500">službena</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <span id={`${inputId}-err`} className="text-action text-[11px]">
          {error}
        </span>
      ) : null}
    </label>
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
    <label className={cn("flex flex-col gap-1.5 lg:gap-1", className)} htmlFor={id}>
      <span className="text-xs font-medium text-ink-700">
        {label}
        {required ? <span className="text-action ml-0.5">*</span> : null}
      </span>
      <input
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cn(
          "ring-border/60 focus-visible:ring-walnut/40 bg-canvas h-10 rounded-xl px-3 text-base text-ink-900 ring-1 transition placeholder:text-ink-300 md:h-11 md:text-sm lg:h-10",
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

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/[\s-]/g, "");
}
