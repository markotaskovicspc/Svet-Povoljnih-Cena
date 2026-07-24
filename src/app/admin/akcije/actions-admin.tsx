"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import { Pencil, Plus, Tag, Users } from "lucide-react";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminActionState } from "@/lib/admin";
import { cn } from "@/lib/utils";
import {
  deleteAction,
  deleteActionProduct,
  deleteLinearPromotion,
  deleteLoyaltyRule,
  lookupActionProduct,
  saveActionProduct,
  upsertAction,
  upsertLinearPromotion,
  upsertLoyaltyRule,
  type PricingMutationResult,
} from "./actions";

type ActionProductRow = {
  productId: string;
  sku: string;
  supplier: string;
  category: string;
  group: string;
  subgroup: string;
  collection: string;
  shortDescription: string;
  shortName: string;
  attribute1: string;
  attribute2: string;
  attribute3: string;
  attribute4: string;
  color1: string;
  color2: string;
  validMpPrice: number;
  salePrice: number;
};

type ActionRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  startsAt: string;
  endsAt: string;
  isHero: boolean;
  isPermanent: boolean;
  sortOrder: number;
  priority: number;
  products: ActionProductRow[];
};

type LoyaltyRuleRow = {
  id: string;
  name: string;
  discountPct: number;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
};

type LinearPromotionRow = {
  id: string;
  name: string;
  discountPct: number;
  priority: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  categoryIds: string[];
  groupIds: string[];
  categories: string[];
  groups: string[];
};

type LookupRow = Omit<ActionProductRow, "salePrice">;
type MutationState = AdminActionState<PricingMutationResult>;

const emptyMutationState = (): MutationState => ({
  ok: false,
  message: "",
});

const kindLabels: Record<string, string> = {
  AKCIJA: "Akcija",
  NEDELJNA: "Nedeljna akcija",
  HEROJI: "Heroji meseca",
  OGRANICENA: "Ograničena ponuda",
  OUTLET: "Outlet",
  CUSTOM: "Posebna akcija",
};

const money = new Intl.NumberFormat("sr-Latn-RS", {
  style: "currency",
  currency: "RSD",
  maximumFractionDigits: 2,
});

const date = new Intl.DateTimeFormat("sr-Latn-RS", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const productColumns: Array<{
  key: keyof LookupRow;
  label: string;
  className?: string;
}> = [
  { key: "supplier", label: "Dobavljač" },
  { key: "category", label: "Kategorija artikala" },
  { key: "group", label: "Grupa artikla" },
  { key: "subgroup", label: "Podgrupa artikla" },
  { key: "collection", label: "Kolekcija" },
  { key: "shortDescription", label: "Kratki opis artikla", className: "min-w-56" },
  { key: "shortName", label: "Kratki naziv artikla", className: "min-w-56" },
  { key: "attribute1", label: "Atribut 1" },
  { key: "attribute2", label: "Atribut 2" },
  { key: "attribute3", label: "Atribut 3" },
  { key: "attribute4", label: "Atribut 4" },
  { key: "color1", label: "Boja 1" },
  { key: "color2", label: "Boja 2" },
];

export function ActionsAdmin({
  actions,
  initialSelectedId,
  loyaltyRules,
  linearPromotions,
  categories,
  groups,
}: {
  actions: ActionRow[];
  initialSelectedId?: string;
  loyaltyRules: LoyaltyRuleRow[];
  linearPromotions: LinearPromotionRow[];
  categories: Array<{ id: string; name: string; path: string; level: number }>;
  groups: Array<{ id: string; name: string }>;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialSelectedId && actions.some((action) => action.id === initialSelectedId)
      ? initialSelectedId
      : actions[0]?.id,
  );
  const [creating, setCreating] = useState(actions.length === 0);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState<MutationState | null>(null);
  const selected =
    actions.find((action) => action.id === selectedId) ?? actions[0];

  const chooseAction = (actionId: string) => {
    setSelectedId(actionId);
    setCreating(false);
    setActionNotice(null);
  };

  const handleActionSaved = useCallback((state: MutationState) => {
    if (!state.result) return;
    setSelectedId(state.result.entityId);
    setCreating(false);
    setActionNotice(state);
  }, []);

  const handleActionDeleted = useCallback(
    (state: MutationState) => {
      const deletedId = state.result?.entityId;
      const nextAction = actions.find((action) => action.id !== deletedId);
      setSelectedId(nextAction?.id);
      setCreating(!nextAction);
      setItemsOpen(false);
      setActionNotice(state);
    },
    [actions],
  );

  return (
    <div className="space-y-6 px-4 py-6 sm:px-8">
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(560px,1.1fr)]">
        <Card className="max-h-[calc(100vh-11rem)] overflow-y-auto p-0">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white px-4 py-3">
            <div>
              <p className="font-display text-lg font-semibold text-ink-900">
                Lista akcija
              </p>
              <p className="text-xs text-ink-500">
                Klik bira akciju; dupli klik otvara njene artikle.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setCreating(true);
                setItemsOpen(false);
                setActionNotice(null);
              }}
            >
              <Plus className="size-4" />
              Nova akcija
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted-bg text-[11px] uppercase tracking-[0.12em] text-ink-500">
                <tr>
                  <th className="px-4 py-2.5">Naziv</th>
                  <th className="px-4 py-2.5">Tip</th>
                  <th className="px-4 py-2.5">Period</th>
                  <th className="px-4 py-2.5 text-right">Prioritet</th>
                  <th className="px-4 py-2.5 text-right">Proizvoda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {actions.map((action) => (
                  <tr
                    key={action.id}
                    tabIndex={0}
                    role="button"
                    aria-current={
                      !creating && action.id === selected?.id ? "true" : undefined
                    }
                    onClick={() => chooseAction(action.id)}
                    onDoubleClick={() => {
                      chooseAction(action.id);
                      setItemsOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        chooseAction(action.id);
                        setItemsOpen(true);
                      }
                    }}
                    className={cn(
                      "cursor-pointer transition hover:bg-muted-bg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-walnut/40",
                      !creating &&
                        action.id === selected?.id &&
                        "bg-brand-blue-50/70",
                    )}
                  >
                    <td className="px-4 py-3 font-medium">{action.name}</td>
                    <td className="px-4 py-3 text-xs text-ink-600">
                      {kindLabels[action.kind] ?? action.kind}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">
                      {date.format(new Date(action.startsAt))} →{" "}
                      {date.format(new Date(action.endsAt))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {action.priority}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {action.products.length}
                    </td>
                  </tr>
                ))}
                {!actions.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-ink-500">
                      Nema akcija. Kreirajte prvu akciju.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
          <CardTitle
            description={
              creating
                ? "Nova akcija će posle čuvanja automatski ostati selektovana."
                : "Ovaj panel se uvek odnosi na selektovanu akciju iz leve liste."
            }
          >
            {creating ? "Nova akcija" : selected ? `Akcija: ${selected.name}` : "Akcija"}
          </CardTitle>
          <MutationMessage state={actionNotice} />
          <ActionEditor
            key={creating ? "new" : selected?.id ?? "empty"}
            action={creating ? undefined : selected}
            onOpenItems={() => setItemsOpen(true)}
            onSaved={handleActionSaved}
            onDeleted={handleActionDeleted}
          />
        </Card>
      </div>

      <div className="grid gap-6 2xl:grid-cols-2">
        <LoyaltyCard rules={loyaltyRules} />
        <LinearPromotionCard
          promotions={linearPromotions}
          categories={categories}
          groups={groups}
        />
      </div>

      {selected && !creating ? (
        <ActionProductsDialog
          key={selected.id}
          action={selected}
          open={itemsOpen}
          onOpenChange={setItemsOpen}
        />
      ) : null}
    </div>
  );
}

function ActionEditor({
  action,
  onOpenItems,
  onSaved,
  onDeleted,
}: {
  action?: ActionRow;
  onOpenItems: () => void;
  onSaved: (state: MutationState) => void;
  onDeleted: (state: MutationState) => void;
}) {
  const deleteFormId = action ? `delete-action-${action.id}` : undefined;
  const [saveState, saveFormAction] = useActionState(
    upsertAction,
    emptyMutationState(),
  );
  const [deleteState, deleteFormAction] = useActionState(
    deleteAction,
    emptyMutationState(),
  );

  useEffect(() => {
    if (saveState.ok && saveState.result) onSaved(saveState);
  }, [onSaved, saveState]);

  useEffect(() => {
    if (deleteState.ok && deleteState.result) onDeleted(deleteState);
  }, [deleteState, onDeleted]);

  return (
    <div>
      <form action={saveFormAction} className="space-y-4">
        <MutationMessage state={saveState.ok ? null : saveState} />
        {action ? <input type="hidden" name="id" value={action.id} /> : null}
        <Field label="Naziv">
          <Input name="name" required defaultValue={action?.name ?? ""} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Slug (opciono)">
            <Input name="slug" defaultValue={action?.slug ?? ""} />
          </Field>
          <Field label="Tip">
            <select
              name="kind"
              defaultValue={action?.kind ?? "AKCIJA"}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Počinje">
            <Input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={action?.startsAt ?? ""}
            />
          </Field>
          <Field label="Završava">
            <Input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={action?.endsAt ?? ""}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Prioritet"
            hint="Ako je artikal u više akcija, pobeđuje veći broj."
          >
            <Input
              name="priority"
              type="number"
              min={0}
              defaultValue={action?.priority ?? 0}
            />
          </Field>
          <Field label="Redosled prikaza">
            <Input
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={action?.sortOrder ?? 0}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isHero"
              defaultChecked={action?.isHero ?? false}
              className="size-4 accent-walnut"
            />
            Glavna akcija
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isPermanent"
              defaultChecked={action?.isPermanent ?? false}
              className="size-4 accent-walnut"
            />
            Trajno niska cena
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Čuvanje…">
              {action ? "Sačuvaj izmene" : "Dodaj akciju"}
            </SubmitButton>
            {action ? (
              <Button type="button" variant="outline" onClick={onOpenItems}>
                <Pencil className="size-4" />
                Artikli ({action.products.length})
              </Button>
            ) : null}
          </div>
          {action ? (
            <SubmitButton
              form={deleteFormId}
              variant="destructive"
              pendingLabel="Brisanje…"
              confirm={`Obrisati akciju „${action.name}“ i sve njene akcijske cene?`}
            >
              Obriši
            </SubmitButton>
          ) : null}
        </div>
      </form>
      {action ? (
        <form
          id={deleteFormId}
          action={deleteFormAction}
          className="mt-3 flex flex-wrap items-center justify-end gap-3"
        >
          <MutationMessage state={deleteState.ok ? null : deleteState} compact />
          <input type="hidden" name="id" value={action.id} />
        </form>
      ) : null}
    </div>
  );
}

function ActionProductsDialog({
  action,
  open,
  onOpenChange,
}: {
  action: ActionRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sku, setSku] = useState("");
  const [preview, setPreview] = useState<LookupRow | null>(null);
  const [lookupMessage, setLookupMessage] = useState("");
  const [productNotice, setProductNotice] = useState<MutationState | null>(null);
  const [isLookingUp, startLookup] = useTransition();
  const [addState, addFormAction] = useActionState(
    saveActionProduct,
    emptyMutationState(),
  );

  const reportProductMutation = useCallback((state: MutationState) => {
    setProductNotice(state);
  }, []);

  const runLookup = () => {
    if (!sku.trim()) return;
    startLookup(async () => {
      const result = await lookupActionProduct(action.id, sku);
      if (!result.ok) {
        setPreview(null);
        setLookupMessage(result.message);
        return;
      }
      setPreview(result.product);
      setLookupMessage("");
      setProductNotice(null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88vh,900px)] w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:!max-w-[calc(100vw-2rem)]">
        <DialogHeader className="border-b border-border px-5 py-4 pr-14">
          <DialogTitle>Artikli na akciji: {action.name}</DialogTitle>
          <DialogDescription>
            Šifru i akcijsku MP cenu unosi korisnik. Ostala polja se popunjavaju
            automatski. Važeća MP cena se čita na datum početka akcije.
          </DialogDescription>
          <MutationMessage
            state={productNotice ?? (addState.message ? addState : null)}
            compact
          />
        </DialogHeader>
        <div className="min-h-0 overflow-auto">
          <table className="min-w-[2550px] border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-20 bg-muted-bg text-[10px] uppercase tracking-[0.1em] text-ink-500">
              <tr>
                <th className="sticky left-0 z-30 min-w-36 border-b border-r border-border bg-muted-bg px-3 py-2.5">
                  Šifra artikla
                </th>
                {productColumns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      "min-w-36 border-b border-border px-3 py-2.5",
                      column.className,
                    )}
                  >
                    {column.label}
                  </th>
                ))}
                <th className="min-w-40 border-b border-border px-3 py-2.5 text-right">
                  Važeća MP cena
                </th>
                <th className="min-w-44 border-b border-border px-3 py-2.5 text-right">
                  Akcijska MP cena
                </th>
                <th className="min-w-28 border-b border-border px-3 py-2.5">
                  Radnje
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-brand-blue-50/60 align-top">
                <td className="sticky left-0 z-10 border-r border-b border-border bg-brand-blue-50 px-3 py-3">
                  <Input
                    value={sku}
                    name="sku"
                    form="add-action-product"
                    placeholder="Unesite šifru"
                    autoComplete="off"
                    onChange={(event) => {
                      setSku(event.target.value);
                      setPreview(null);
                      setLookupMessage("");
                      setProductNotice(null);
                    }}
                    onBlur={runLookup}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        runLookup();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={runLookup}
                    disabled={isLookingUp || !sku.trim()}
                    className="mt-1 text-[11px] font-medium text-walnut hover:underline disabled:opacity-50"
                  >
                    {isLookingUp ? "Učitavanje…" : "Popuni podatke"}
                  </button>
                  {lookupMessage ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {lookupMessage}
                    </p>
                  ) : null}
                </td>
                {productColumns.map((column) => (
                  <td
                    key={column.key}
                    className="border-b border-border px-3 py-3 text-ink-700"
                  >
                    {preview?.[column.key] ?? "—"}
                  </td>
                ))}
                <td className="border-b border-border px-3 py-3 text-right font-medium tabular-nums">
                  {preview ? money.format(preview.validMpPrice) : "—"}
                </td>
                <td className="border-b border-border px-3 py-3">
                  <Input
                    form="add-action-product"
                    name="salePrice"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    disabled={!preview}
                    className="text-right tabular-nums"
                    placeholder="0,00"
                  />
                </td>
                <td className="border-b border-border px-3 py-3">
                  <form id="add-action-product" action={addFormAction}>
                    <input type="hidden" name="actionId" value={action.id} />
                    <SubmitButton size="sm" disabled={!preview}>
                      Dodaj
                    </SubmitButton>
                  </form>
                </td>
              </tr>
              {action.products.map((product, index) => {
                const saveFormId = `save-action-product-${index}`;
                return (
                  <tr key={product.productId} className="align-top hover:bg-muted-bg/50">
                    <td className="sticky left-0 z-10 border-r border-b border-border bg-white px-3 py-3 font-mono font-medium">
                      {product.sku}
                    </td>
                    {productColumns.map((column) => (
                      <td
                        key={column.key}
                        className="border-b border-border px-3 py-3 text-ink-700"
                      >
                        {product[column.key]}
                      </td>
                    ))}
                    <td className="border-b border-border px-3 py-3 text-right font-medium tabular-nums">
                      {money.format(product.validMpPrice)}
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      <Input
                        form={saveFormId}
                        name="salePrice"
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        defaultValue={product.salePrice}
                        className="text-right tabular-nums"
                      />
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      <ActionProductControls
                        actionId={action.id}
                        product={product}
                        saveFormId={saveFormId}
                        onResult={reportProductMutation}
                      />
                    </td>
                  </tr>
                );
              })}
              {!action.products.length ? (
                <tr>
                  <td
                    colSpan={17}
                    className="px-4 py-10 text-center text-sm text-ink-500"
                  >
                    Akcija još nema artikle. Unesite prvu šifru u plavom redu.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionProductControls({
  actionId,
  product,
  saveFormId,
  onResult,
}: {
  actionId: string;
  product: ActionProductRow;
  saveFormId: string;
  onResult: (state: MutationState) => void;
}) {
  const [saveState, saveFormAction] = useActionState(
    saveActionProduct,
    emptyMutationState(),
  );
  const [deleteState, deleteFormAction] = useActionState(
    deleteActionProduct,
    emptyMutationState(),
  );

  useEffect(() => {
    if (saveState.message) onResult(saveState);
  }, [onResult, saveState]);

  useEffect(() => {
    if (deleteState.message) onResult(deleteState);
  }, [deleteState, onResult]);

  return (
    <>
      <form id={saveFormId} action={saveFormAction}>
        <input type="hidden" name="actionId" value={actionId} />
        <input type="hidden" name="sku" value={product.sku} />
        <SubmitButton size="sm" variant="outline">
          Sačuvaj
        </SubmitButton>
      </form>
      <form action={deleteFormAction} className="mt-1">
        <input type="hidden" name="actionId" value={actionId} />
        <input type="hidden" name="productId" value={product.productId} />
        <SubmitButton
          size="xs"
          variant="ghost"
          className="text-destructive"
          pendingLabel="…"
          confirm={`Ukloniti artikal ${product.sku} iz akcije?`}
        >
          Ukloni
        </SubmitButton>
      </form>
    </>
  );
}

function LoyaltyCard({ rules }: { rules: LoyaltyRuleRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [notice, setNotice] = useState<MutationState | null>(null);
  const selectedRule = rules.find((rule) => rule.id === selectedId);

  const handleSaved = useCallback((state: MutationState) => {
    setNotice(state);
    if (state.result?.mode === "create") {
      setSelectedId(null);
      setEditorVersion((version) => version + 1);
    } else {
      setSelectedId(state.result?.entityId ?? null);
    }
  }, []);

  const handleDeleted = useCallback((state: MutationState) => {
    setNotice(state);
    setSelectedId(null);
    setEditorVersion((version) => version + 1);
  }, []);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardTitle description="Promena procenta pravi novi red i deaktivira prethodni, pa istorija ostaje sačuvana.">
          <span className="inline-flex items-center gap-2">
            <Users className="size-5" />
            Program lojalnosti
          </span>
        </CardTitle>
        {selectedRule ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedId(null);
              setNotice(null);
            }}
          >
            <Plus className="size-4" />
            Novo pravilo
          </Button>
        ) : null}
      </div>
      <MutationMessage state={notice} />
      <LoyaltyEditor
        key={selectedRule?.id ?? `new-loyalty-${editorVersion}`}
        rule={selectedRule}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
      <div className="mt-5 max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted-bg text-ink-500">
            <tr>
              <th className="px-3 py-2">Naziv</th>
              <th className="px-3 py-2 text-right">Popust</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Radnje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rules.map((rule) => (
              <tr
                key={rule.id}
                className={cn(
                  selectedRule?.id === rule.id && "bg-brand-blue-50/70",
                )}
              >
                <td className="px-3 py-2">{rule.name}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {rule.discountPct}%
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                  {rule.startsAt ? date.format(new Date(rule.startsAt)) : "—"} →{" "}
                  {rule.endsAt ? date.format(new Date(rule.endsAt)) : "—"}
                </td>
                <td className="px-3 py-2">
                  {rule.active ? "Aktivno" : "Neaktivno"}
                </td>
                <td className="px-3 py-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setSelectedId(rule.id);
                      setNotice(null);
                    }}
                  >
                    Izmeni
                  </Button>
                </td>
              </tr>
            ))}
            {!rules.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-500">
                  Nema loyalty istorije.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LoyaltyEditor({
  rule,
  onSaved,
  onDeleted,
}: {
  rule?: LoyaltyRuleRow;
  onSaved: (state: MutationState) => void;
  onDeleted: (state: MutationState) => void;
}) {
  const [saveState, saveFormAction] = useActionState(
    upsertLoyaltyRule,
    emptyMutationState(),
  );
  const [deleteState, deleteFormAction] = useActionState(
    deleteLoyaltyRule,
    emptyMutationState(),
  );

  useEffect(() => {
    if (saveState.ok && saveState.result) onSaved(saveState);
  }, [onSaved, saveState]);

  useEffect(() => {
    if (deleteState.ok && deleteState.result) onDeleted(deleteState);
  }, [deleteState, onDeleted]);

  return (
    <div>
      <form action={saveFormAction} className="space-y-3">
        <MutationMessage state={saveState.ok ? null : saveState} />
        {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Naziv pravila">
            <Input
              name="name"
              required
              placeholder="Loyalty avgust"
              defaultValue={rule?.name ?? ""}
            />
          </Field>
          <Field
            label="Procenat popusta"
            hint={rule ? "Promena procenta kreira novi istorijski zapis." : undefined}
          >
            <Input
              name="discountPct"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              required
              defaultValue={rule?.discountPct}
            />
          </Field>
          <Field label="Važenje od">
            <Input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={rule?.startsAt ?? ""}
            />
          </Field>
          <Field label="Važenje do">
            <Input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={rule?.endsAt ?? ""}
            />
          </Field>
          <Field label="Prioritet">
            <Input
              name="priority"
              type="number"
              min={0}
              defaultValue={rule?.priority ?? 0}
            />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={rule?.active ?? false}
              className="size-4 accent-walnut"
            />
            Aktivno
          </label>
        </div>
        <SubmitButton pendingLabel="Čuvanje…">
          {rule ? "Sačuvaj pravilo" : "Dodaj u istoriju"}
        </SubmitButton>
      </form>
      {rule ? (
        <form
          action={deleteFormAction}
          className="mt-2 flex flex-wrap items-center justify-end gap-3"
        >
          <MutationMessage state={deleteState.ok ? null : deleteState} compact />
          <input type="hidden" name="id" value={rule.id} />
          <SubmitButton
            size="sm"
            variant="destructive"
            pendingLabel="Brisanje…"
            confirm={`Trajno obrisati loyalty zapis „${rule.name}“ iz istorije?`}
          >
            Obriši zapis
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function LinearPromotionCard({
  promotions,
  categories,
  groups,
}: {
  promotions: LinearPromotionRow[];
  categories: Array<{ id: string; name: string; path: string; level: number }>;
  groups: Array<{ id: string; name: string }>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [notice, setNotice] = useState<MutationState | null>(null);
  const selectedPromotion = promotions.find(
    (promotion) => promotion.id === selectedId,
  );

  const handleSaved = useCallback((state: MutationState) => {
    setNotice(state);
    if (state.result?.mode === "create") {
      setSelectedId(null);
      setEditorVersion((version) => version + 1);
    } else {
      setSelectedId(state.result?.entityId ?? null);
    }
  }, []);

  const handleDeleted = useCallback((state: MutationState) => {
    setNotice(state);
    setSelectedId(null);
    setEditorVersion((version) => version + 1);
  }, []);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardTitle description="Bez izabrane kategorije i grupe, popust važi za ceo asortiman.">
          <span className="inline-flex items-center gap-2">
            <Tag className="size-5" />
            Linearni popust na asortiman
          </span>
        </CardTitle>
        {selectedPromotion ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedId(null);
              setNotice(null);
            }}
          >
            <Plus className="size-4" />
            Nova promocija
          </Button>
        ) : null}
      </div>
      <MutationMessage state={notice} />
      <LinearPromotionEditor
        key={selectedPromotion?.id ?? `new-linear-${editorVersion}`}
        promotion={selectedPromotion}
        categories={categories}
        groups={groups}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
      <div className="mt-5 max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted-bg text-ink-500">
            <tr>
              <th className="px-3 py-2">Naziv</th>
              <th className="px-3 py-2">Obuhvat</th>
              <th className="px-3 py-2 text-right">Popust</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Radnje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {promotions.map((promotion) => {
              const scope = [...promotion.categories, ...promotion.groups];
              return (
                <tr
                  key={promotion.id}
                  className={cn(
                    selectedPromotion?.id === promotion.id &&
                      "bg-brand-blue-50/70",
                  )}
                >
                  <td className="px-3 py-2">
                    {promotion.name}
                    {!promotion.active ? (
                      <span className="ml-1 text-ink-400">(neaktivna)</span>
                    ) : null}
                  </td>
                  <td className="max-w-52 truncate px-3 py-2 text-ink-500">
                    {scope.length ? scope.join(", ") : "Ceo asortiman"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {promotion.discountPct}%
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                    {date.format(new Date(promotion.startsAt))} →{" "}
                    {date.format(new Date(promotion.endsAt))}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setSelectedId(promotion.id);
                        setNotice(null);
                      }}
                    >
                      Izmeni
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!promotions.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-500">
                  Nema linearnih promocija.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LinearPromotionEditor({
  promotion,
  categories,
  groups,
  onSaved,
  onDeleted,
}: {
  promotion?: LinearPromotionRow;
  categories: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  onSaved: (state: MutationState) => void;
  onDeleted: (state: MutationState) => void;
}) {
  const [saveState, saveFormAction] = useActionState(
    upsertLinearPromotion,
    emptyMutationState(),
  );
  const [deleteState, deleteFormAction] = useActionState(
    deleteLinearPromotion,
    emptyMutationState(),
  );

  useEffect(() => {
    if (saveState.ok && saveState.result) onSaved(saveState);
  }, [onSaved, saveState]);

  useEffect(() => {
    if (deleteState.ok && deleteState.result) onDeleted(deleteState);
  }, [deleteState, onDeleted]);

  return (
    <div>
      <form action={saveFormAction} className="space-y-3">
        <MutationMessage state={saveState.ok ? null : saveState} />
        {promotion ? (
          <input type="hidden" name="id" value={promotion.id} />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Naziv promocije">
            <Input
              name="name"
              required
              placeholder="Letnji dodatni popust"
              defaultValue={promotion?.name ?? ""}
            />
          </Field>
          <Field label="Procenat popusta">
            <Input
              name="discountPct"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              required
              defaultValue={promotion?.discountPct}
            />
          </Field>
          <Field label="Period od">
            <Input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={promotion?.startsAt ?? ""}
            />
          </Field>
          <Field label="Period do">
            <Input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={promotion?.endsAt ?? ""}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceList
            title="Kategorije"
            name="categoryIds"
            options={categories}
            selectedIds={promotion?.categoryIds}
          />
          <ChoiceList
            title="Grupe"
            name="groupIds"
            options={groups}
            selectedIds={promotion?.groupIds}
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Prioritet" className="w-32">
            <Input
              name="priority"
              type="number"
              min={0}
              defaultValue={promotion?.priority ?? 0}
            />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={promotion?.active ?? false}
              className="size-4 accent-walnut"
            />
            Aktivna
          </label>
          <SubmitButton className="mb-0.5" pendingLabel="Čuvanje…">
            {promotion ? "Sačuvaj promociju" : "Dodaj promociju"}
          </SubmitButton>
        </div>
      </form>
      {promotion ? (
        <form
          action={deleteFormAction}
          className="mt-2 flex flex-wrap items-center justify-end gap-3"
        >
          <MutationMessage state={deleteState.ok ? null : deleteState} compact />
          <input type="hidden" name="id" value={promotion.id} />
          <SubmitButton
            size="sm"
            variant="destructive"
            pendingLabel="Brisanje…"
            confirm={`Trajno obrisati linearnu promociju „${promotion.name}“?`}
          >
            Obriši promociju
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function ChoiceList({
  title,
  name,
  options,
  selectedIds = [],
}: {
  title: string;
  name: string;
  options: Array<{ id: string; name: string }>;
  selectedIds?: string[];
}) {
  const selected = new Set(selectedIds);
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
        {title}
      </legend>
      <div className="max-h-32 space-y-1 overflow-auto">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name={name}
              value={option.id}
              defaultChecked={selected.has(option.id)}
              className="size-4 accent-walnut"
            />
            {option.name}
          </label>
        ))}
        {!options.length ? (
          <p className="text-xs text-ink-500">Nema dostupnih vrednosti.</p>
        ) : null}
      </div>
    </fieldset>
  );
}

function MutationMessage({
  state,
  compact = false,
}: {
  state?: AdminActionState | null;
  compact?: boolean;
}) {
  if (!state?.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        !compact && "mb-3",
        state.ok
          ? "border-success/25 bg-success/10 text-success"
          : "border-destructive/25 bg-destructive/10 text-destructive",
      )}
    >
      {state.message}
    </p>
  );
}
