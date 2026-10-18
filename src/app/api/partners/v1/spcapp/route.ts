import { spcappGet } from '@/lib/partners/spcapp/http.server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = (request: Request) => spcappGet(request);
