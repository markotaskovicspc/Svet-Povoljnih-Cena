'use server';
import { randomBytes, createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { withAdminState } from '@/lib/admin';
import type { AdminActionState } from '@/lib/admin/action-state';
export type NewSpcappKey = { clientId: string; token: string };
export async function createSpcappKey(_state: AdminActionState<NewSpcappKey>, form: FormData): Promise<AdminActionState<NewSpcappKey>> {
  return withAdminState<[], NewSpcappKey>({ module: "/admin/erp/spcapp", allowed: ['SUPER'], action: 'spcapp.key.create', entity: 'PartnerApiClient' }, async () => {
    const name = String(form.get('name') ?? 'SPCApp').trim();
    if (!name || name.length > 100) return { ok: false, error: 'Naziv mora imati 1–100 znakova.' };
    const token = `spcapp_${randomBytes(32).toString('hex')}`;
    const client = await db.partnerApiClient.create({ data: { name, keyPrefix: token.slice(0, 18), keyHash: createHash('sha256').update(token).digest('hex'), scopes: ['spcapp:read'], rateLimit: 120 }, select: { id: true } });
    revalidatePath('/admin/erp/spcapp');
    // The token is returned once to this authenticated admin, never put in audit diff.
    return { ok: true, entityId: client.id, diff: { name, scopes: ['spcapp:read'], rateLimit: 120 }, result: { clientId: client.id, token }, message: 'Ključ je napravljen. Kopirajte ga u serverske tajne SPCApp-a; posle napuštanja stranice neće biti dostupan.' };
  })();
}
export async function revokeSpcappKey(_state: AdminActionState, form: FormData) {
  return withAdminState({ module: "/admin/erp/spcapp", allowed: ['SUPER'], action: 'spcapp.key.revoke', entity: 'PartnerApiClient' }, async () => {
    const id = String(form.get('id') ?? '');
    const result = await db.partnerApiClient.updateMany({ where: { id, scopes: { has: 'spcapp:read' } }, data: { enabled: false } });
    if (result.count !== 1) return { ok: false, error: 'SPCApp ključ nije pronađen.' };
    revalidatePath('/admin/erp/spcapp');
    return { ok: true, entityId: id, diff: { enabled: false }, message: 'Pristup ovim ključem je opozvan.' };
  })();
}
