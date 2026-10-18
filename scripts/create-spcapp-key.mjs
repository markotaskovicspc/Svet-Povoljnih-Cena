// Never prints the bearer token. The receiving application needs the local env file.
import { randomBytes, createHash } from 'node:crypto';
import { writeFile, unlink, chmod } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
config({ path: process.env.ENV_FILE || '.env.local', quiet: true });
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const output = option('--out');
const revoke = option('--revoke');
const configured = value => value?.trim() && !/^GET_FROM_/i.test(value.trim()) ? value.trim() : null;
const connection = configured(process.env.POSTGRES_URL_NON_POOLING) || configured(process.env.DATABASE_URL);
if (!connection || (!revoke && (!output || !isAbsolute(output)))) {
  console.error('Usage: ENV_FILE=/absolute/private/env node scripts/create-spcapp-key.mjs --out /absolute/private/new-file.env [--name SPCApp] OR --revoke CLIENT_ID. Requires a direct database URL.');
  process.exit(1);
}
let url;
try { url = new URL(connection); } catch { console.error('Invalid database URL.'); process.exit(1); }
if (url.port === '6543') { console.error('Use the direct/session port 5432, not the transaction pooler.'); process.exit(1); }
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) && !url.searchParams.has('sslmode')) {
  url.searchParams.set('sslmode', 'require'); url.searchParams.set('uselibpqcompat', 'true');
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] });
let written = false;
try {
  if (revoke) {
    const result = await db.partnerApiClient.update({ where: { id: revoke }, data: { enabled: false } });
    console.log(JSON.stringify({ revokedClientId: result.id }));
  } else {
    const key = `spcapp_${randomBytes(32).toString('hex')}`;
    const base = configured(process.env.NEXT_PUBLIC_BASE_URL) || 'https://www.svetpovoljnihcena.rs';
    await writeFile(output, `SPCAPP_ERP_BASE_URL=${base}\nSPCAPP_ERP_API_KEY=${key}\n`, { flag: 'wx', mode: 0o600 });
    written = true;
    await chmod(output, 0o600);
    const client = await db.partnerApiClient.create({ data: { name: option('--name') || 'SPCApp', keyPrefix: key.slice(0, 18), keyHash: createHash('sha256').update(key).digest('hex'), scopes: ['spcapp:read'], rateLimit: 120 } });
    written = false;
    console.log(JSON.stringify({ clientId: client.id, scopes: client.scopes, credentialsFile: output, note: 'Token saved locally; not printed. Store it only in the SPCApp server secret store.' }));
  }
} catch (error) {
  if (written) await unlink(output).catch(() => {});
  console.error(`SPCApp key operation failed (${error?.name || 'Error'}). No secret was printed.`);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
