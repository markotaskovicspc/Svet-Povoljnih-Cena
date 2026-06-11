import { NextResponse } from "next/server";
import { presignSchema, presignUpload } from "@/lib/api/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = presignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  try {
    return NextResponse.json(await presignUpload(parsed.data));
  } catch (err) {
    return NextResponse.json(
      {
        error: "upload_unavailable",
        message: err instanceof Error ? err.message : "Upload trenutno nije dostupan.",
      },
      { status: 503 },
    );
  }
}
