import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canAccessOrder, readOrderAccessToken } from "@/lib/api/order-access";
import { getCurrentUser } from "@/lib/auth/session";
import { cancelWebOrderByCustomer } from "@/lib/orders/cancellation.server";
import { OrderCancellationError } from "@/lib/orders/cancellation";

export async function POST(
  request: Request,
  context: { params: Promise<{ orderNumber: string }> },
) {
  const { orderNumber } = await context.params;
  const order = await db.order.findUnique({
    where: { number: orderNumber },
    select: {
      id: true,
      userId: true,
      publicAccessTokenHash: true,
    },
  });
  if (!order) {
    return NextResponse.json(
      { ok: false, message: "Porudžbina nije pronađena." },
      { status: 404 },
    );
  }
  const token = readOrderAccessToken(request);
  if (!(await canAccessOrder({ order, token }))) {
    return NextResponse.json(
      { ok: false, message: "Nemate pravo da otkažete ovu porudžbinu." },
      { status: 403 },
    );
  }
  const user = await getCurrentUser();
  try {
    const result = await cancelWebOrderByCustomer({
      orderId: order.id,
      requestedByUserId:
        user?.userType === "customer" && user.id === order.userId
          ? user.id
          : null,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof OrderCancellationError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "IN_PROGRESS" ? 409 : 422;
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status },
      );
    }
    console.error("[order-cancel] failed", error);
    return NextResponse.json(
      { ok: false, message: "Otkazivanje trenutno nije uspelo. Pokušajte ponovo." },
      { status: 500 },
    );
  }
}
