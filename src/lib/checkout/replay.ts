import type { Prisma } from "@prisma/client";
import type { CreateOrderInput } from "./order-schema";
import { formatStreetAddress } from "@/lib/address/house-number";

// Both the optimistic replay and the replay found under the session lock must
// validate the same persisted buyer, basket and delivery details.
export const checkoutReplaySelect = {
  userId: true, guestEmail: true, guestLoyaltyEmail: true, paymentMethod: true, shippingMethod: true,
  voucherCode: true, notes: true, billingSameAsShipping: true,
  shipFirstName: true, shipLastName: true, shipPhone: true,
  shipStreet: true, shipHouseNumber: true, shipCity: true,
  shipPostalCode: true, shipCountry: true,
  shipXExpressTownId: true, shipXExpressStreetId: true,
  shipCompanyName: true, shipPib: true,
  billFirstName: true, billLastName: true, billStreet: true,
  billHouseNumber: true, billCity: true, billPostalCode: true,
  billXExpressTownId: true, billXExpressStreetId: true,
  billCompanyName: true, billPib: true,
  items: { select: { sku: true, qty: true, withAssembly: true } },
} satisfies Prisma.OrderSelect;

type ReplayOrder = Prisma.OrderGetPayload<{ select: typeof checkoutReplaySelect }>;
const clean = (value: string | null | undefined) => value?.trim() || null;
const email = (value: string | null | undefined) => clean(value)?.toLowerCase() ?? null;

function business(address: CreateOrderInput["shipping"]) {
  const enabled = address.liceType === "pravno" ||
    (!address.liceType && Boolean(address.companyName || address.pib));
  return enabled ? [clean(address.companyName), clean(address.pib)] : [null, null];
}

export function checkoutRequestMatchesOrder(
  input: CreateOrderInput,
  userId: string | null,
  order: ReplayOrder,
) {
  if (order.userId !== userId || (!userId && email(input.guestEmail) !== email(order.guestEmail))) {
    return false;
  }
  if (!userId && Boolean(input.guestLoyalty) !== Boolean(order.guestLoyaltyEmail)) return false;
  const ship = input.shipping;
  const courier = input.shippingMethod === "KURIR";
  const townId = courier ? (ship.xExpressTownId ?? null) : null;
  const streetId = courier ? (ship.xExpressStreetId ?? null) : null;
  const bill = input.billingSameAsShipping ? null : input.billing;
  const lines = (items: Array<{ sku: string; qty: number; withAssembly?: boolean }>) =>
    items.map(item => [item.sku, item.qty, !!item.withAssembly])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const requested = [
    input.paymentMethod, input.shippingMethod,
    clean(input.voucherCode)?.toUpperCase() ?? null, clean(input.notes),
    input.billingSameAsShipping,
    clean(ship.firstName), clean(ship.lastName), clean(ship.phone),
    clean(formatStreetAddress(ship.street, ship.houseNumber)), clean(ship.houseNumber),
    townId, streetId,
    // The courier dictionary canonicalizes city/postcode when saving. Its id
    // is authoritative, so harmless display-label differences are not a change.
    townId ? null : clean(ship.city), townId ? null : clean(ship.postalCode),
    clean(ship.country), ...business(ship),
    bill ? [clean(bill.firstName), clean(bill.lastName),
      clean(formatStreetAddress(bill.street, bill.houseNumber)), clean(bill.houseNumber),
      clean(bill.city), clean(bill.postalCode), bill.xExpressTownId ?? null,
      bill.xExpressStreetId ?? null, ...business(bill)] : null,
    lines(input.lines),
  ];
  const saved = [
    order.paymentMethod, order.shippingMethod,
    clean(order.voucherCode)?.toUpperCase() ?? null, clean(order.notes),
    order.billingSameAsShipping,
    clean(order.shipFirstName), clean(order.shipLastName), clean(order.shipPhone),
    clean(order.shipStreet), clean(order.shipHouseNumber),
    order.shipXExpressTownId, order.shipXExpressStreetId,
    order.shipXExpressTownId ? null : clean(order.shipCity),
    order.shipXExpressTownId ? null : clean(order.shipPostalCode),
    clean(order.shipCountry), clean(order.shipCompanyName), clean(order.shipPib),
    order.billingSameAsShipping ? null : [clean(order.billFirstName), clean(order.billLastName),
      clean(order.billStreet), clean(order.billHouseNumber), clean(order.billCity),
      clean(order.billPostalCode), order.billXExpressTownId, order.billXExpressStreetId,
      clean(order.billCompanyName), clean(order.billPib)],
    lines(order.items),
  ];
  return JSON.stringify(requested) === JSON.stringify(saved);
}
