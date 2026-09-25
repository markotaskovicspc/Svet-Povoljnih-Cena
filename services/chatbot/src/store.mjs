import pg from 'pg';
import { seal, unseal } from './security.mjs';
export class Store {
  constructor(url, key) { this.pool = new pg.Pool({connectionString: url, max: 12}); this.key = key; }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS spc_chat_conversations (
      id text PRIMARY KEY, channel text NOT NULL, account text NOT NULL, sender text NOT NULL,
      paused boolean NOT NULL DEFAULT false, reason text, last_customer bigint NOT NULL DEFAULT 0,
      state text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS spc_chat_events (
      id text PRIMARY KEY, conversation text NOT NULL REFERENCES spc_chat_conversations(id),
      payload text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
      next_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS spc_chat_pending ON spc_chat_events(status,next_at);
      CREATE TABLE IF NOT EXISTS spc_chat_outbox (
      id text PRIMARY KEY, conversation text NOT NULL REFERENCES spc_chat_conversations(id),
      payload text NOT NULL, status text NOT NULL DEFAULT 'pending', meta_id text,
      created_at timestamptz NOT NULL DEFAULT now());`);
  }
  async accept(event) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO spc_chat_conversations(id,channel,account,sender,state) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [event.conversation,event.channel,event.account,event.sender,seal({history:[],orders:[]},this.key)]);
      const inserted = await c.query(`INSERT INTO spc_chat_events(id,conversation,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [event.id,event.conversation,seal(event,this.key)]);
      if (inserted.rowCount && !event.echo) await c.query(`UPDATE spc_chat_conversations SET last_customer=GREATEST(last_customer,$2),updated_at=now() WHERE id=$1`, [event.conversation,event.timestamp]);
      if (event.echo && !event.botEcho) {
        const ours = await c.query('SELECT id FROM spc_chat_outbox WHERE meta_id=$1',[event.id.substring(event.channel.length+1)]);
        if (!ours.rowCount) await c.query(`UPDATE spc_chat_conversations SET paused=true,reason='Odgovor zaposlenog u Meta inboxu',updated_at=now() WHERE id=$1`,[event.conversation]);
      }
      await c.query(`SELECT pg_notify('spc_chat_wakeup','')`);
      await c.query('COMMIT');
    } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async withConversation(id, callback) {
    const c = await this.pool.connect(); let locked = false;
    try {
      const result = await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[id]);
      locked = result.rows[0].locked;
      if (!locked) return;
      const row = (await c.query('SELECT * FROM spc_chat_conversations WHERE id=$1',[id])).rows[0];
      await callback(row, unseal(row.state,this.key), c);
    } finally { if (locked) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[id]); c.release(); }
  }
  async save(c, id, state) { await c.query('UPDATE spc_chat_conversations SET state=$2,updated_at=now() WHERE id=$1',[id,seal(state,this.key)]); }
  async pause(id, reason) { await this.pool.query('UPDATE spc_chat_conversations SET paused=true,reason=$2,updated_at=now() WHERE id=$1',[id,reason]); }
  async enqueue(c, id, conversation, message) { await c.query('INSERT INTO spc_chat_outbox(id,conversation,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,conversation,seal(message,this.key)]); }
  decode(value) { return unseal(value,this.key); }
  async close() { await this.pool.end(); }
}
