import { spcappGet } from '@/lib/partners/spcapp/http.server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  return spcappGet(request, (await context.params).resource);
}
