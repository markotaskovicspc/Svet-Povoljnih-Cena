import { classifyOrderIntent } from './order-intent.mjs';
import { randomUUID } from 'node:crypto';
import { answer, quoteMessage } from './agent.mjs';
import { inWindow, isConfirmation, isOrderConfirmation } from './security.mjs';

export class Worker {
  constructor({store,spc,accounts,model,graphVersion,enabled=false,testSenders=[],answerFn=answer,intentFn=classifyOrderIntent}) {
    Object.assign(this,{store,spc,accounts,model,graphVersion,enabled,testSenders,answerFn,intentFn}); this.busy=false;
  }
  async start() {
    // LISTEN starts work immediately; timer only recovers missed notifications/retries.
    this.listener=await this.store.pool.connect();
    await this.listener.query('LISTEN spc_chat_wakeup');
    this.listener.on('notification',()=>void this.tick());
    this.listener.on('error',()=>console.error('chat.listener.disconnected'));
    this.timer=setInterval(()=>void this.tick(),2000);
    await this.tick();
  }
  allowed(sender) { return this.enabled || this.testSenders.includes(sender); }
  async tick() {
    if(this.busy) return; this.busy=true;
    try {
      const rows=await this.store.pool.query(`SELECT DISTINCT conversation FROM spc_chat_events WHERE status='pending' AND next_at<=now() LIMIT 8`);
      await Promise.all(rows.rows.map(r=>this.store.withConversation(r.conversation,async(row,state,c)=>{
        const events=await c.query(`SELECT * FROM spc_chat_events WHERE conversation=$1 AND status='pending' ORDER BY created_at,id LIMIT 1`,[row.id]);
        const job=events.rows[0]; if(!job || new Date(job.next_at)>new Date()) return;
        const event=this.store.decode(job.payload);
        if(event.echo || row.paused || !this.allowed(row.sender) || !inWindow(event.timestamp)) {
          await c.query(`UPDATE spc_chat_events SET status='skipped' WHERE id=$1`,[job.id]); return;
        }
        const recent=await c.query(`SELECT count(*)::int AS n FROM spc_chat_events WHERE conversation=$1 AND created_at>now()-interval '1 minute'`,[row.id]);
        if(recent.rows[0].n>25) {await this.store.pause(row.id,'Previše poruka; potrebna ručna provera');return;}
        try {
          let intent;
          if(state.pending && !state.reclamationInFlight && !event.attachments.length) {
            if(state.confirming?.eventId===event.id || isConfirmation(event.text,state.pending.code)) intent='confirm';
            else intent=await this.intentFn({text:event.text,history:state.history,pending:state.pending,model:this.model});
            if(intent==='confirm') {
              // Persist the chosen quote before writing: a timeout retries the same order.
              state.confirming={eventId:event.id,quoteToken:state.pending.quoteToken};
              await this.store.save(c,row.id,state);
            } else if(intent==='change') {delete state.pending;delete state.confirming;}
          }
          let message;
          let images=[];
          if (state.reclamationInFlight) {
            await this.store.pause(row.id,'Proveriti prethodno slanje reklamacije pre nastavka');
            await c.query(`UPDATE spc_chat_events SET status='failed' WHERE id=$1`,[job.id]);
            return;
          } else if (event.attachments.length) {
            await this.store.pause(row.id,'Prilog/slika zahteva pregled zaposlenog');
            message='Primili smo prilog. Prosledio sam razgovor kolegama da provere artikal ili reklamaciju.';
          } else if (state.pending && intent==='cancel') {
            delete state.pending;delete state.confirming;
            message='U redu, odustali smo od ove ponude. Porudžbina nije kreirana.';
          } else if (state.pending && intent==='unclear') {
            message='Da li želite da naručimo sve iz poslednje ponude po prikazanom ukupnom iznosu, bez izmena?';
          } else if (state.pending && intent==='confirm') {
            const result=await this.spc({action:'create_order',channel:event.channel,conversationId:row.id,quoteToken:state.confirming.quoteToken});
            if(result.ok) {
              state.orders.push({number:result.data.number,accessToken:result.data.accessToken});
              message=`Porudžbina ${result.data.number} je uspešno kreirana. Ukupno: ${result.data.total} RSD, sa dostavom. Potvrda stiže i na mejl.`;
              delete state.pending;delete state.confirming;
            } else {
              message='Porudžbina nije kreirana. Ponuda je istekla ili su se cena/dostupnost promenile. Proveriću ponovo podatke pre nove potvrde.';
              delete state.pending;
            }
          } else if (state.reclamation && isConfirmation(event.text,state.reclamation.code)) {
            const r=state.reclamation,order=state.orders.find(o=>o.number===r.number);
            if (!order || Date.now()-r.createdAt>15*60_000) {message='Potvrda reklamacije je istekla. Pošaljite ponovo opis problema.';delete state.reclamation;}
            else {
              // Reclamation API has no idempotency contract: never blindly retry a write.
              state.reclamationInFlight=true; await this.store.save(c,row.id,state);
              const result=await this.spc({action:'reclamation',input:{orderNumberOrFiscal:r.number,sku:r.sku,quantity:r.quantity,description:r.description,photos:[]},accessToken:order.accessToken});
              message=result.ok ? `Reklamacija ${result.number} je zabeležena. Kolege će pregledati prijavu.` : 'Prijavu treba da proveri zaposleni. Prosleđujem mu razgovor.';
              state.reclamationInFlight=false; delete state.reclamation;
              if(!result.ok) await this.store.pause(row.id,'Reklamacija zahteva proveru');
            }
          } else if (!state.pending && !state.reclamation && state.orders.length && isOrderConfirmation(event.text)) {
            message=`Porudžbina ${state.orders.at(-1).number} je već kreirana. Nije napravljena nova porudžbina. Ako želite izmenu, napišite šta menjate.`;
          } else {
            if(state.reclamationInFlight) throw new Error('RECLAMATION_UNCERTAIN');
            const result=await this.answerFn({event,state,spc:this.spc,model:this.model,pause:reason=>this.store.pause(row.id,reason)});
            const normalizedReply=String(result.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'dj');
            const unverifiedSuccess=!result.quoteCreated && !state.orders.some(o=>String(result.text).includes(o.number)) && /potvrdjeno|porudzbin[^.!?\n]{0,70}(?:kreiran|potvrdjen|evidentiran|primljen|uspesn)/i.test(normalizedReply);
            if(unverifiedSuccess) {
              result.text='Porudžbina još nije kreirana u sistemu. Za naručivanje je potrebna važeća ponuda i vaša potvrda.';
              if(state.pending) result.text+='\n\n'+quoteMessage(state.pending);
            }
            if(!result.quoteCreated && !unverifiedSuccess && intent!=='question') delete state.pending;
            if(!state.handedOff && !state.reclamation) images=(result.images??[]).slice(0,3);
            message=result.quoteCreated ? quoteMessage(state.pending) : result.text;
            if(state.reclamation) message=`Prijava za ${state.reclamation.number}, artikal ${state.reclamation.sku}, količina ${state.reclamation.quantity}:\n${state.reclamation.description}\n\nZa slanje prijave napišite: POTVRĐUJEM ${state.reclamation.code}`;
            if(message.length>1850) {
              delete state.pending; delete state.reclamation;
              await this.store.pause(row.id,'Složena ponuda zahteva zaposlenog');
              message='Za ovu ponudu potreban je zaposleni. Prosledio sam mu razgovor da proveri sve stavke i dostavu.';
            }
          }
          state.history.push({role:'user',content:event.text || '[Prilog kupca]'},{role:'assistant',content:message});
          state.history=state.history.slice(-30);
          await c.query('BEGIN');
          await this.store.save(c,row.id,state);
          await this.store.enqueue(c,`reply:${job.id}`,row.id,{text:message,allowPaused:state.handedOff===true || event.attachments.length>0 || message.includes('zaposleni')});
          for(const [index,image] of images.entries()) await this.store.enqueue(c,`reply:${job.id}:image:${index}`,row.id,{imageUrl:image.url});
          await c.query(`UPDATE spc_chat_events SET status='done' WHERE id=$1`,[job.id]);
          await c.query('COMMIT');
        } catch {
          await c.query('ROLLBACK');
          // A complaint write may have committed before a timeout. Escalate for reconciliation.
          if(state.reclamationInFlight || job.attempts>=2) {
            await this.store.pause(row.id,state.reclamationInFlight?'Proveriti ishod slanja reklamacije':'Greška servisa; potreban odgovor zaposlenog');
            await c.query(`UPDATE spc_chat_events SET status='failed',attempts=attempts+1 WHERE id=$1`,[job.id]);
          } else await c.query(`UPDATE spc_chat_events SET attempts=attempts+1,next_at=now()+interval '10 seconds' WHERE id=$1`,[job.id]);
          console.error('chat.processing_failed');
        }
      })));
      await this.flush();
    } catch { console.error('chat.worker_failed'); } finally {this.busy=false;}
  }
  async flush() {
    const result=await this.store.pool.query(`SELECT DISTINCT conversation FROM spc_chat_outbox WHERE status IN ('pending','sending') LIMIT 8`);
    for(const item of result.rows) await this.store.withConversation(item.conversation,async(row,_state,c)=>{
      const rows=await c.query(`SELECT * FROM spc_chat_outbox WHERE conversation=$1 AND status IN ('pending','sending') ORDER BY created_at,id LIMIT 1`,[row.id]);
      const out=rows.rows[0]; if(!out) return;
      if(out.status==='sending') {await this.store.pause(row.id,'Nepotvrđen ishod slanja odgovora; proveriti Meta inbox');await c.query(`UPDATE spc_chat_outbox SET status='uncertain' WHERE id=$1`,[out.id]);return;}
      const message=this.store.decode(out.payload);
      if(!inWindow(Number(row.last_customer)) || (!this.allowed(row.sender) && !message.human) || (row.paused&&!message.allowPaused&&!message.human)) {
        await c.query(`UPDATE spc_chat_outbox SET status='suppressed' WHERE id=$1`,[out.id]); return;
      }
      const account=this.accounts.find(a=>a.channel===row.channel&&a.id===row.account);
      if(!account) return;
      await c.query(`UPDATE spc_chat_outbox SET status='sending' WHERE id=$1`,[out.id]);
      try {
        const host=account.login==='instagram'?'graph.instagram.com':'graph.facebook.com';
        const payload={recipient:{id:row.sender},message:message.imageUrl?{attachment:{type:'image',payload:{url:message.imageUrl}}}:{text:message.text.slice(0,1900)}};
        if(row.channel==='facebook'){payload.messaging_type='RESPONSE';payload.message.metadata='spc-bot';}
        const res=await fetch(`https://${host}/${this.graphVersion}/${account.id}/messages`,{method:'POST',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000),redirect:'error'});
        const data=await res.json();
        if(message.imageUrl && res.status===400 && data.error?.code===100) {
          // Definite media rejection: the product link was sent first, keep chat usable.
          await c.query(`UPDATE spc_chat_outbox SET status='failed' WHERE id=$1`,[out.id]);
          console.error('chat.image_rejected');return;
        }
        if(!res.ok||!data.message_id) throw new Error('META_SEND_FAILED');
        await c.query(`UPDATE spc_chat_outbox SET status='sent',meta_id=$2 WHERE id=$1`,[out.id,data.message_id]);
      } catch {await this.store.pause(row.id,'Greška ili nepoznat ishod slanja; proveriti Meta inbox');await c.query(`UPDATE spc_chat_outbox SET status='uncertain' WHERE id=$1`,[out.id]);console.error('chat.send_uncertain');}
    });
  }
  async humanReply(id,text) {
    await this.store.withConversation(id,async(row,state,c)=>{
      if(!inWindow(Number(row.last_customer))) throw new Error('MESSAGE_WINDOW_CLOSED');
      await this.store.pause(id,'Razgovor preuzeo zaposleni');
      state.history.push({role:'assistant',content:text}); await this.store.save(c,id,state);
      await this.store.enqueue(c,`human:${randomUUID()}`,id,{text,human:true});
    });
    void this.tick();
  }
  async stop() {clearInterval(this.timer);if(this.listener){await this.listener.query('UNLISTEN *');this.listener.release();}while(this.busy)await new Promise(r=>setTimeout(r,100));}
}
