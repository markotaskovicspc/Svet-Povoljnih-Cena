import {it,expect} from 'vitest';
import {supportEmail} from '@/lib/social/support-email';
it('puts the actual order failure first and uses only ERP conversation links',()=>{
 const result=supportEmail({reason:'Komanda /porudzbina',transcript:'RAZLOG: Loyalty članstvo nije povezano bez mejla.\nSto × 1, mikser × 1',customerName:'Test Kupac',inboxUrl:'https://business.facebook.com/latest/inbox/all/?asset_id=123'});
 expect(result.text.indexOf('Loyalty članstvo')).toBeLessThan(result.text.indexOf('Sledeći korak'));
 expect(result.text).toContain('nemojte praviti novu');expect(result.text).toContain('Test Kupac');
 expect(result.html).not.toContain('railway');expect(result.html).not.toContain('business.facebook.com');expect(result.text).not.toContain('Business Suite');expect(result.text).toContain('Preuzmi razgovor');expect(result.html).not.toContain('<pre');
 expect(supportEmail({reason:'<script>bad</script>',transcript:'&test'}).html).not.toContain('<script>');
});
it('links every valid channel to its exact protected ERP conversation without embedding a key',()=>{
 for(const conversationId of ['facebook:123:456','instagram:123:456','web:spc:11111111-1111-4111-8111-111111111111']){
 const result=supportEmail({channel:conversationId.split(':')[0],conversationId,reason:'Pomoć',transcript:'Kupac čeka odgovor'});
 expect(result.html).toContain('/admin/razgovori?conversation='+encodeURIComponent(conversationId));expect(result.html).not.toContain('railway');expect(result.html).not.toContain('token=');
 }
 const invalid=supportEmail({conversationId:'facebook:bad?x=<script>',reason:'Pomoć',transcript:'Test'});expect(invalid.html).not.toContain('conversation=');expect(invalid.html).toContain('/admin/razgovori');
});

it('makes a captured callback address visible and lets support reply directly',()=>{
 const result=supportEmail({channel:'web',conversationId:'web:spc:synthetic',reason:'Kupac traži čoveka',transcript:'Kupac: Ne uspevam da dobijem pomoć',callbackEmail:'buyer@example.com'});
 expect(result.replyTo).toBe('buyer@example.com');expect(result.text).toContain('Mejl za odgovor kupcu: buyer@example.com');
 expect(result.text).toContain('Javite se kupcu na navedeni mejl');expect(result.html).toContain('buyer@example.com');expect(result.text).not.toContain('Business Suite');
});
