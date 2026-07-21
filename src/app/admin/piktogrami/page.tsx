import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import Image from "next/image";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { logOperationalError } from "@/lib/monitoring";
import {
  getManagedPictogramIconKey,
  PICTOGRAM_ICON_PREFIX,
  validatePictogramIconFile,
} from "@/lib/pictograms/icon-file";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Piktogrami",
  robots: { index: false, follow: false },
};

const schema = z.object({
  id: z.string().optional().nullable(),
  code: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/i),
  label: z.string().min(1).max(80),
});

async function uploadPictogramIcon(code: string, file: File) {
  const extension = validatePictogramIconFile(file);
  const key = `${PICTOGRAM_ICON_PREFIX}${code.toLowerCase()}-${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  const { error } = await storage.upload(key, Buffer.from(await file.arrayBuffer()), {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`Upload ikone nije uspeo: ${error.message}`);

  const { data } = storage.getPublicUrl(key);
  if (!data.publicUrl) {
    await storage.remove([key]);
    throw new Error("Javni URL otpremljene ikone nije moguće napraviti.");
  }
  return { key, iconUrl: data.publicUrl };
}

async function removeManagedPictogramIcon(
  iconUrl: string | null | undefined,
  context: Record<string, unknown>,
) {
  const key = getManagedPictogramIconKey(iconUrl);
  if (!key) return;
  const { error } = await createAdminClient()
    .storage
    .from(getProductMediaBucket())
    .remove([key]);
  if (error) {
    logOperationalError("pictogram.icon_cleanup_failed", error, { ...context, key });
  }
}

async function revalidatePictogramProducts(pictogramId: string) {
  const relations = await db.productPictogram.findMany({
    where: { pictogramId },
    select: { product: { select: { slug: true } } },
  });
  for (const relation of relations) {
    revalidatePath(`/p/${relation.product.slug}`);
  }
}

async function upsert(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT"], action: "pictogram.upsert", entity: "Pictogram" },
    async (_a, formData: FormData) => {
      const parsed = schema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Greška.",
        };
      }
      const { id, code, label } = parsed.data;
      const existing = id
        ? await db.pictogram.findUnique({ where: { id } })
        : null;
      if (id && !existing) {
        return { ok: false as const, error: "Piktogram više ne postoji." };
      }

      const file = formData.get("iconFile");
      let uploaded: Awaited<ReturnType<typeof uploadPictogramIcon>> | null = null;
      if (file instanceof File && file.size > 0) {
        try {
          uploaded = await uploadPictogramIcon(code, file);
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Upload ikone nije uspeo.",
          };
        }
      }

      const iconUrl = uploaded?.iconUrl ?? existing?.iconUrl;
      if (!iconUrl) {
        return { ok: false as const, error: "Izaberite ikonu za upload." };
      }

      let saved;
      try {
        saved = id
          ? await db.pictogram.update({ where: { id }, data: { code, label, iconUrl } })
          : await db.pictogram.create({ data: { code, label, iconUrl } });
      } catch (error) {
        if (uploaded) {
          await removeManagedPictogramIcon(uploaded.iconUrl, {
            id,
            code,
            reason: "database_save_failed",
          });
        }
        throw error;
      }

      if (uploaded && existing?.iconUrl !== uploaded.iconUrl) {
        await removeManagedPictogramIcon(existing?.iconUrl, {
          id: saved.id,
          code,
          reason: "icon_replaced",
        });
      }
      revalidatePath("/admin/piktogrami");
      await revalidatePictogramProducts(saved.id);
      return {
        ok: true as const,
        entityId: saved.id,
        diff: { code, label, iconUrl, storageKey: uploaded?.key },
        message: id ? "Piktogram je sačuvan." : "Piktogram je dodat.",
      };
    },
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "pictogram.delete", entity: "Pictogram" },
    async (_a, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID." };
      const pictogram = await db.pictogram.findUnique({
        where: { id },
        include: {
          products: { select: { product: { select: { slug: true } } } },
        },
      });
      if (!pictogram) {
        return { ok: false as const, error: "Piktogram više ne postoji." };
      }
      await db.pictogram.delete({ where: { id } });
      await removeManagedPictogramIcon(pictogram.iconUrl, {
        id,
        code: pictogram.code,
        reason: "pictogram_deleted",
      });
      revalidatePath("/admin/piktogrami");
      for (const relation of pictogram.products) {
        revalidatePath(`/p/${relation.product.slug}`);
      }
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

export default async function PictogramsPage() {
  await requireAdminAction(["CONTENT"]);
  const items = await db.pictogram.findMany({ orderBy: { code: "asc" } });

  return (
    <>
      <PageHeader
        title="Piktogrami"
        description={'Bedževi koje proizvod može da nosi (npr. „brza isporuka", „uštedi 20%").'}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Piktogrami" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-[1fr_360px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.length === 0 ? (
            <p className="col-span-full text-sm text-ink-500">Nema piktograma.</p>
          ) : (
            items.map((p) => (
              <Card key={p.id} id={`edit-${p.id}`} className="scroll-mt-24 p-4">
                <div className="flex items-center gap-3">
                  <div className="relative size-10 overflow-hidden rounded-md bg-muted-bg">
                    {p.iconUrl ? (
                      <Image
                        src={p.iconUrl}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-contain"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.label}</p>
                    <p className="truncate font-mono text-[11px] text-ink-500">{p.code}</p>
                  </div>
                </div>
                <PictogramForm action={upsert} values={p} />
                <form action={remove} className="mt-2 flex justify-end">
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                    Obriši
                  </SubmitButton>
                </form>
              </Card>
            ))
          )}
        </div>
        <Card>
          <CardTitle>Novi piktogram</CardTitle>
          <PictogramForm action={upsert} />
        </Card>
      </div>
    </>
  );
}

function PictogramForm({
  action,
  values,
}: {
  action: (
    state: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  values?: { id?: string; code?: string; label?: string; iconUrl?: string };
}) {
  return (
    <AdminActionForm action={action} className="mt-3 space-y-2">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Kod">
        <Input
          name="code"
          required
          maxLength={40}
          pattern="[A-Za-z0-9_-]+"
          defaultValue={values?.code ?? ""}
        />
      </Field>
      <Field label="Labela">
        <Input name="label" required maxLength={80} defaultValue={values?.label ?? ""} />
      </Field>
      <Field
        label={values?.iconUrl ? "Zameni ikonu" : "Ikona"}
        hint="PNG, JPG ili WebP, najviše 750 KB. Kvadratna slika sa providnom pozadinom daje najbolji rezultat."
      >
        <Input
          name="iconFile"
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          required={!values?.iconUrl}
        />
      </Field>
      <div className="flex justify-end">
        <SubmitButton size="sm" pendingLabel="Otpremanje…">
          {values?.id ? "Sačuvaj" : "Dodaj"}
        </SubmitButton>
      </div>
    </AdminActionForm>
  );
}
