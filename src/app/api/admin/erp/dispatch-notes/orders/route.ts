import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { getDispatchOrderLines } from "@/lib/admin/dispatch-note.server";

export async function GET(request: Request) {
  await requireAdminAction(["OPS"]);
  const search = new URL(request.url).searchParams;
  try {
    const lines = await getDispatchOrderLines({
      receiverCustomerId: search.get("receiverCustomerId") ?? "",
      sourceWarehouseId: search.get("sourceWarehouseId") ?? "",
      from: search.get("from") ?? "",
      to: search.get("to") ?? "",
      excludeDispatchId: search.get("excludeDispatchId"),
    });
    return NextResponse.json({ ok: true, lines });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Porudžbine nisu učitane.",
      },
      { status: 400 },
    );
  }
}
