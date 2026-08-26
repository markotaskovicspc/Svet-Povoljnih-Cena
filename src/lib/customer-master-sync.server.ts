import "server-only";

import type { Prisma } from "@prisma/client";
import { inferCustomerGender } from "@/lib/admin/customer-master";
import {
  normalizeWebCustomerEmail,
  normalizeWebCustomerPhone,
  webCustomerIdentity,
  webGuestCustomerId,
  webUserCustomerId,
} from "@/lib/customer-master-identity";

type WebCustomerAddress = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  companyName?: string | null;
  pib?: string | null;
};

export async function syncRegisteredCustomer(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  return upsertWebCustomer(tx, { userId });
}

export async function upsertWebCustomer(
  tx: Prisma.TransactionClient,
  input: {
    userId: string | null;
    guestEmail?: string | null;
    address?: WebCustomerAddress;
  },
) {
  const user = input.userId
    ? await tx.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          firstName: true,
          lastName: true,
          companyName: true,
          pib: true,
        },
      })
    : null;
  if (input.userId && !user) {
    throw new Error("Kupac korisničkog naloga ne postoji.");
  }

  const profileName = splitProfileName(user?.name);
  const email = normalizeWebCustomerEmail(input.guestEmail ?? user?.email);
  const phone = cleanText(input.address?.phone) ?? cleanText(user?.phone);
  const normalizedPhone = normalizeWebCustomerPhone(phone);
  const firstName =
    cleanText(input.address?.firstName) ??
    cleanText(user?.firstName) ??
    profileName.firstName;
  const lastName =
    cleanText(input.address?.lastName) ??
    cleanText(user?.lastName) ??
    profileName.lastName;
  const companyName =
    cleanText(input.address?.companyName) ?? cleanText(user?.companyName);
  const pib = cleanText(input.address?.pib) ?? cleanText(user?.pib);
  const identity = webCustomerIdentity({ email, phone: normalizedPhone });
  const data = customerData({
    firstName,
    lastName,
    companyName,
    pib,
    address: cleanText(input.address?.street),
    city: cleanText(input.address?.city),
    postalCode: cleanText(input.address?.postalCode),
    country: cleanText(input.address?.country)?.toUpperCase() ?? null,
    phone,
    email,
  });

  if (user) {
    const existing = await tx.customer.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    let customerId = existing?.id ?? null;

    if (!customerId && identity) {
      const guestId = webGuestCustomerId(identity);
      const guest = await tx.customer.findUnique({
        where: { id: guestId },
        select: { id: true, userId: true },
      });
      if (guest && !guest.userId) {
        const adopted = await tx.customer.update({
          where: { id: guest.id },
          data: { ...data.update, userId: user.id },
          select: { id: true },
        });
        customerId = adopted.id;
      }
    }

    if (!customerId) {
      const customer = await tx.customer.upsert({
        where: { userId: user.id },
        create: {
          id: webUserCustomerId(user.id),
          userId: user.id,
          ...data.create,
        },
        update: data.update,
        select: { id: true },
      });
      customerId = customer.id;
    } else {
      await tx.customer.update({
        where: { id: customerId },
        data: data.update,
      });
    }

    await tx.order.updateMany({
      where: { userId: user.id, customerId: null },
      data: { customerId },
    });
    return { id: customerId };
  }

  if (!identity) {
    throw new Error("Gostujući kupac nema e-mail adresu ni telefon.");
  }
  const customer = await tx.customer.upsert({
    where: { id: webGuestCustomerId(identity) },
    create: {
      id: webGuestCustomerId(identity),
      ...data.create,
    },
    update: data.update,
    select: { id: true },
  });
  return customer;
}

function customerData(input: {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  pib: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}) {
  const create = {
    firstName: input.firstName,
    lastName: input.lastName,
    companyName: input.companyName,
    pib: input.pib,
    address: input.address,
    city: input.city,
    postalCode: input.postalCode,
    country: input.country ?? "RS",
    phone: input.phone,
    email: input.email,
    gender: inferCustomerGender(input.firstName),
  } satisfies Prisma.CustomerUncheckedCreateInput;
  const update = Object.fromEntries(
    Object.entries({
      ...create,
      country: input.country,
      gender: input.firstName ? inferCustomerGender(input.firstName) : null,
    }).filter(([, value]) => value != null && value !== ""),
  ) as Prisma.CustomerUncheckedUpdateInput;
  return { create, update };
}

function cleanText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") || null;
}

function splitProfileName(value: string | null | undefined) {
  const name = cleanText(value);
  if (!name) return { firstName: null, lastName: null };
  const [firstName, ...rest] = name.split(" ");
  return { firstName: firstName || null, lastName: rest.join(" ") || null };
}
