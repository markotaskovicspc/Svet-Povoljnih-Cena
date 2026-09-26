import { orderErrorMessage } from './delivery.mjs';
import { classifyOrderIntent } from './order-intent.mjs';
import { randomUUID } from 'node:crypto';
import { answer, quoteMessage } from './agent.mjs';
import { inWindow, isConfirmation } from './security.mjs';
import {HISTORY_LIMIT,repeatsCompletedOrder,customerFromQuote} from './conversation-context.mjs';
import {checkCart} from './cart-check.mjs';
import {readMetaHistory} from './meta-history.mjs';
import {classifyCancellation,cancellationMessage} from './cancellation.mjs';
import {classifyReclamation,reclamationMessage,receiveClaimPhotos,prepareReclamation} from './reclamation.mjs';

export class Worker {
  constructor({store,spc,accounts,model,graphVersion,enabled=false,testSenders=[],answerFn=answer,intentFn=classifyOrderIntent,cartCheckFn=checkCart,cancellationIntentFn=classifyCancellation,reclamationIntentFn=classifyReclamation}) {
    Object.assign(this,{store,spc,accounts,model,graphVersion,enabled,testSenders,answerFn,intentFn,cartCheckFn,cancellationIntentFn,reclamationIntentFn}); this.busy=false;
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
        // Recover only legacy bot handoffs. Operator and safety pauses stay intact.
        if(!event.echo && row.paused && state.handedOff && !state.reclamationInFlight &&
          !/Ručna pauza|Razgovor preuzeo zaposleni|Odgovor zaposlenog|Previše poruka|Greška|Nepotvrđen|Proveriti|Reklamacija zahteva proveru/i.test(row.reason??'')) {
          delete state.handedOff;delete state.pending;delete state.confirming;
          await this.store.save(c,row.id,state);
          await c.query('UPDATE spc_chat_conversations SET paused=false,reason=NULL WHERE id=$1',[row.id]);row.paused=false;
        }
        if(event.echo || row.paused || !this.allowed(row.sender) || !inWindow(event.timestamp)) {
          await c.query(`UPDATE spc_chat_events SET status='skipped' WHERE id=$1`,[job.id]); return;
        }
        const recent=await c.query(`SELECT count(*)::int AS n FROM spc_chat_events WHERE conversation=$1 AND created_at>now()-interval '1 minute'`,[row.id]);
        if(recent.rows[0].n>25) {await this.store.pause(row.id,'Previše poruka; potrebna ručna provera');return;}
        try {
          if(state.historyVersion!==2){
            const recovered=await this.store.history(c,row.id,event);
            const local=recovered.length?recovered:state.history;
            const account=this.accounts.find(a=>a.channel===row.channel&&a.id===row.account);
            try {
              const before=local.length?Number(local[0].timestamp)||0:event.timestamp;
              const older=before?await readMetaHistory({account,sender:row.sender,before,graphVersion:this.graphVersion}):[];
              state.history=[...older,...local].slice(-HISTORY_LIMIT);
              state.historyImport=account?'available':'local';
            } catch {state.history=local;state.historyImport='unavailable';console.error('chat.history_import_unavailable');}
            state.historyVersion=2;
          }
          if(state.reclamationContext&&Date.now()-state.reclamationContext.createdAt>2*3600000)delete state.reclamationContext;
          let reclamationIntent;
          if(state.reclamation?.reclamationToken&&!event.attachments.length) {
            delete state.pending;delete state.confirming;delete state.cancellation;
            reclamationIntent=state.submittingReclamation?.eventId===event.id?'confirm':await this.reclamationIntentFn({text:event.text,history:state.history,pending:state.reclamation,model:this.model});
            if(reclamationIntent==='other')delete state.reclamation;
          }
          let intent;
          let cancellationIntent;
          if(state.cancellation && !state.reclamationInFlight && !event.attachments.length) {
            // Purchase and cancellation confirmations never share an active draft.
            delete state.pending;delete state.confirming;
            cancellationIntent=state.cancelling?.eventId===event.id?'confirm':await this.cancellationIntentFn({text:event.text,history:state.history,pending:state.cancellation,model:this.model});
            if(cancellationIntent==='other') delete state.cancellation;
          }
          if(state.pending?.input?.lines && !state.pending.selectionChecked && !state.confirming) {
            const items=[];
            for(const line of state.pending.input.lines){
              const found=await this.spc({action:'search',query:line.sku});
              const product=found.items?.find(p=>p.sku===line.sku);
              items.push({...line,name:product?.name??state.pending.productNames?.[line.sku]??''});
            }
            const selection=await this.cartCheckFn({state,event,items,model:this.model});
            if(selection.ok)state.pending.selectionChecked=true;
            else {delete state.pending;delete state.confirming;}
          }
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
          } else if (state.claimVerification && /^\s*\d{6}\s*$/.test(event.text)) {
            const verify=state.claimVerification;
            const result=await this.spc({action:'reclamation_verify_finish',channel:event.channel,conversationId:row.id,challenge:verify.challenge,code:event.text.trim()});
            if(result.ok) {
              state.claimOrders??={};state.claimOrders[result.order.number]={proof:result.proof,items:result.order.items};
              delete state.claimVerification;
              message='Porudžbina je povezana sa ovim razgovorom. Na koji artikal se odnosi problem: '+result.order.items.map(i=>i.name).slice(0,6).join(', ')+'?';
            } else {
              message='Kod nije prihvaćen ili je istekao. Možete zatražiti novi kod ili pomoć kolege.';
              if(result.error?.code!=='VERIFICATION_INVALID')delete state.claimVerification;
            }
          } else if (state.reclamation?.reclamationToken && reclamationIntent==='confirm') {
            const pending=state.reclamation;
            if(pending.expiresAt<Date.now()&&!state.submittingReclamation) {
              message='Sažetak prijave je istekao. Prijava nije poslata. Napišite da obnovimo prijavu sa istim podacima.';delete state.reclamation;
            } else {
              state.submittingReclamation={eventId:event.id};await this.store.save(c,row.id,state);
              const result=await this.spc({action:'submit_reclamation',channel:event.channel,conversationId:row.id,reclamationToken:pending.reclamationToken});
              if(result.ok) {
                state.reclamations??=[];if(!state.reclamations.some(r=>r.number===result.number))state.reclamations.push({number:result.number,orderNumber:pending.number,sku:pending.input.sku});
                message='Reklamacija '+result.number+' je zabeležena. Kolege će pregledati prijavu i javiti se o daljim koracima.';
                state.supportRequest={reason:'Nova reklamacija '+result.number,reclamationId:result.id};
                delete state.reclamationContext;
              } else {
                message='Reklamacija još nije upisana. Prikupljeni zahtev šaljem podršci da proveri porudžbinu i prijavu.';
                state.supportRequest={reason:'Reklamacija za '+pending.number+' zahteva proveru'};
              }
              delete state.reclamation;delete state.submittingReclamation;
            }
          } else if (state.reclamation?.reclamationToken && reclamationIntent==='decline') {
            message='U redu, prijava reklamacije nije poslata.';delete state.reclamation;delete state.reclamationContext;
          } else if (state.reclamation?.reclamationToken && reclamationIntent==='unclear') {
            message=reclamationMessage(state.reclamation);
          } else if (state.cancellation && cancellationIntent==='confirm') {
            const pending=state.cancellation,order=state.orders.find(o=>o.number===pending.number);
            if(!order || (pending.expiresAt<Date.now()&&!state.cancelling)) {
              message='Potvrda otkazivanja je istekla. Porudžbina nije otkazana. Napišite ponovo koju porudžbinu želite da otkažete.';
              delete state.cancellation;delete state.cancelling;
            } else {
              state.cancelling={eventId:event.id};await this.store.save(c,row.id,state);
              const result=await this.spc({action:'cancel_order',channel:event.channel,conversationId:row.id,cancellationToken:pending.cancellationToken,accessToken:order.accessToken});
              if(result.ok) {
                order.status='OTKAZANO';
                message=`Porudžbina ${order.number} je ${result.alreadyCancelled?'već ':''}otkazana.`;
                if(result.paymentReviewRequired||result.shipmentReviewRequired||result.alreadyCancelled) {
                  message+=' Ako je već plaćena ili predata kuriru, podrška će proveriti uplatu i isporuku.';
                  state.supportRequest={reason:`Provera uplate/isporuke nakon otkazivanja ${order.number}`};
                }
              } else {
                message=`Porudžbina ${order.number} nije otkazana. Trenutni status zahteva proveru podrške; prosleđujem zahtev kolegama.`;
                state.supportRequest={reason:`Otkazivanje nije izvršeno: ${order.number}`};
              }
              delete state.cancellation;delete state.cancelling;
            }
          } else if (state.cancellation && cancellationIntent==='decline') {
            message=`U redu, ne otkazujemo porudžbinu ${state.cancellation.number}.`;
            delete state.cancellation;
          } else if (state.cancellation && cancellationIntent==='unclear') {
            message=cancellationMessage(state.cancellation);
          } else if (event.attachments.length) {
            delete state.cancellation;delete state.pending;delete state.confirming;
            if(state.reclamationContext) {
              const previous=state.reclamation;
              const imported=await receiveClaimPhotos({event,state,spc:this.spc});
              message=imported.added?'Fotografije su dodate prijavi.':'Fotografiju trenutno nisam uspeo da dodam. Prijavu možemo nastaviti bez nje, a podrška će proveriti prilog.';
              if(imported.failed) {state.supportRequest={reason:'Prilog reklamacije zahteva ručnu proveru'};message+=' Deo priloga zahteva proveru podrške.';}
              if(previous?.input) {
                await prepareReclamation({input:{...previous.input,number:previous.number},event,state,spc:this.spc});
                if(state.reclamation)message=reclamationMessage(state.reclamation)+(imported.failed?'\nNeki prilozi nisu dodati; podrška će ih proveriti.':'');
              } else message+=' Opišite problem i napišite da li želite zamenu, popravku ili drugi dogovor.';
            } else {
              state.claimAttachments=event.attachments.slice(0,5).map(a=>({...a,timestamp:Date.now()}));
              message='Primio sam prilog. Da li se odnosi na reklamaciju i, ako da, na koju porudžbinu i artikal?';
            }
          } else if (state.pending && intent==='cancel') {
            delete state.pending;delete state.confirming;
            message='U redu, odustali smo od ove ponude. Porudžbina nije kreirana.';
          } else if (state.pending && intent==='unclear') {
            message='Da li želite da naručimo sve iz poslednje ponude po prikazanom ukupnom iznosu, bez izmena?';
          } else if (state.pending && intent==='confirm') {
            const result=await this.spc({action:'create_order',channel:event.channel,conversationId:row.id,quoteToken:state.confirming.quoteToken});
            if(result.ok) {
              state.customer=customerFromQuote(state.pending.input)??state.customer;
              state.orders.push({number:result.data.number,accessToken:result.data.accessToken,items:state.pending.input?.lines?.map(l=>({...l,name:state.pending.productNames?.[l.sku]})),createdAt:Date.now()});
              message=`Porudžbina ${result.data.number} je uspešno kreirana. Ukupno: ${result.data.total} RSD, sa dostavom. Potvrda stiže i na mejl.`;
              delete state.pending;delete state.confirming;
            } else {
              const code=result.error?.code;
              console.error('chat.order_rejected',{code:typeof code==='string'&&/^[A-Z_]+$/.test(code)?code:'UNKNOWN'});
              message=orderErrorMessage(code);
              delete state.pending;
            }
          } else if (!state.pending && !state.reclamation && repeatsCompletedOrder(state,event.text)) {
            message=`Porudžbina ${state.orders.at(-1).number} je već kreirana. Nije napravljena nova porudžbina. Ako želite izmenu, napišite šta menjate.`;
          } else {
            if(state.reclamationInFlight) throw new Error('RECLAMATION_UNCERTAIN');
            delete state.claimStatusNotice;
            const result=await this.answerFn({event,state,spc:this.spc,model:this.model,pause:reason=>this.store.pause(row.id,reason)});
            const normalizedReply=String(result.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'dj');
            const unverifiedSuccess=!result.quoteCreated && !state.orders.some(o=>String(result.text).includes(o.number)) && /potvrdjeno|porudzbin[^.!?\n]{0,70}(?:kreiran|potvrdjen|evidentiran|primljen|uspesn)/i.test(normalizedReply);
            if(unverifiedSuccess) {
              result.text=state.orders.length
                ? 'Nije kreirana nova porudžbina. Prethodne porudžbine su sačuvane. Napišite broj porudžbine koju želite da proverim.'
                : 'Porudžbina još nije kreirana u sistemu. Za naručivanje je potrebna važeća ponuda i vaša potvrda.';
              if(state.pending) result.text+='\n\n'+quoteMessage(state.pending);
            }
            if(!result.quoteCreated && !unverifiedSuccess && intent!=='question') delete state.pending;
            if(!state.supportRequest && !state.reclamation) images=(result.images??[]).slice(0,3);
            message=result.quoteCreated ? quoteMessage(state.pending) : result.text;
            if(state.cancellation) {message=cancellationMessage(state.cancellation);images=[];}
            else if(/(?:porudzbina[^.!?\n]{0,70} je (?:uspesno )?(?:otkazana|stornirana)|(?:otkazao|stornirao) sam|^otkazano[.!])/i.test(normalizedReply) && !state.orders.some(o=>o.status==='OTKAZANO'&&String(result.text).includes(o.number))) {
              message='Otkazivanje još nije potvrđeno u sistemu. Napišite broj porudžbine koju želite da otkažete, pa ću proveriti mogućnost otkazivanja.';
            }
            if(!state.reclamation && /reklamacija[^.!?\n]{0,90}(?:zabelezena|kreirana|primljena|evidentirana)|prijava[^.!?\n]{0,70}(?:zabelezena|kreirana|evidentirana)/i.test(normalizedReply) && !(state.reclamations??[]).some(r=>String(result.text).includes(r.number))) message='Prijava još nije potvrđena u sistemu. Pripremimo sažetak reklamacije za vašu potvrdu.';
            if(state.reclamation?.reclamationToken) message=reclamationMessage(state.reclamation);
            else if(state.reclamation) {delete state.reclamation;message='Pripremimo ponovo kratak sažetak reklamacije. Napišite koji artikal prijavljujete.';}
            if(state.claimStatusNotice){message=state.claimStatusNotice;delete state.claimStatusNotice;images=[];}
            if(message.length>1850) {
              delete state.pending; delete state.reclamation;delete state.cancellation;
              state.supportRequest={reason:'Složena ponuda zahteva zaposlenog'};
              message='Za ovu ponudu potreban je zaposleni. Prosledio sam mu razgovor da proveri sve stavke i dostavu.';
            }
          }
          state.history.push({role:'user',content:/^\s*\d{6}\s*$/.test(event.text)&&Boolean(state.claimVerification||state.claimOrders)?'[Kod za proveru porudžbine]':event.text || '[Prilog kupca]',timestamp:event.timestamp},{role:'assistant',content:message,timestamp:Date.now()});
          state.history=state.history.slice(-HISTORY_LIMIT);
          await c.query('BEGIN');
          if(state.supportRequest) {
            const payload={action:'support_handoff',id:job.id,channel:event.channel,conversationId:row.id,
              reason:state.supportRequest.reason,reclamationId:state.supportRequest.reclamationId,transcript:state.history.slice(-8).map(m=>`${m.role==='user'?'Kupac':'SPC'}: ${m.content}`).join('\n').slice(-6000)};
            await c.query('INSERT INTO spc_chat_support(id,conversation,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[job.id,row.id,this.store.encode(payload)]);
            delete state.supportRequest;
          }
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
      await this.flushSupport();
    } catch { console.error('chat.worker_failed'); } finally {this.busy=false;}
  }
  async flushSupport() {
    const pending=await this.store.pool.query("SELECT DISTINCT conversation FROM spc_chat_support WHERE status='pending' AND next_at<=now() LIMIT 8");
    for(const item of pending.rows) await this.store.withConversation(item.conversation,async(_row,_state,c)=>{
      const result=await c.query("SELECT * FROM spc_chat_support WHERE conversation=$1 AND status='pending' AND next_at<=now() ORDER BY created_at LIMIT 1",[item.conversation]);
      const job=result.rows[0];if(!job)return;
      try {
        const sent=await this.spc(this.store.decode(job.payload));
        if(!sent.ok)throw Error('SUPPORT_EMAIL_FAILED');
        await c.query("UPDATE spc_chat_support SET status='sent' WHERE id=$1",[job.id]);
      } catch {
        await c.query("UPDATE spc_chat_support SET attempts=attempts+1,next_at=now()+interval '5 minutes' WHERE id=$1",[job.id]);
        console.error('chat.support_email_pending');
      }
    });
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
