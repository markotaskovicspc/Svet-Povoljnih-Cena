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

it('opens the source Facebook comment instead of the general ERP inbox',()=>{
 const result=supportEmail({channel:'facebook',conversationId:'comment:facebook:123:456_789',reason:'Komentar zahteva podršku zaposlenog',transcript:'Objava 123_456; komentar 456_789\nGde je moja porudžbina?'});
 const link=new URL(result.text.match(/Otvori ovaj komentar na Facebook-u: (\S+)/)![1]);
 expect(link.origin+link.pathname).toBe('https://www.facebook.com/permalink.php');
 expect(Object.fromEntries(link.searchParams)).toEqual({story_fbid:'456',id:'123',comment_id:'789'});
 expect(result.html).toContain('story_fbid=456&amp;id=123&amp;comment_id=789');
 expect(result.text).toContain('Otvorite komentar na Facebook-u');
 expect(result.text).not.toContain('Preuzmi razgovor');expect(result.html).not.toContain('/admin/razgovori');
 expect(result.text).toContain('Gde je moja porudžbina?');
});

it('supports numeric source IDs and CRLF without changing the selected comment',()=>{
 const result=supportEmail({conversationId:'comment:facebook:123:789',reason:'Pomoć',transcript:'Objava 456; komentar 789\r\nTest'});
 expect(result.text).toContain('story_fbid=456&id=123&comment_id=789');
});

it('does not invent a private chat or a source link when comment metadata is unavailable or mismatched',()=>{
 for(const [conversationId,transcript] of [
  ['comment:instagram:123:789','Objava 456; komentar 789\nPomoć'],
  ['comment:facebook:123:456_789','Objava 123_456; komentar 456_999\nPomoć'],
  ['comment:facebook:123:456_789','Objava 999_456; komentar 456_789\nPomoć'],
  ['comment:facebook:123:456_789','Bez izvornog zaglavlja'],
  ['comment:facebook:123:bad?token=secret','Objava 123_456; komentar 456_789\nPomoć'],
 ]){
  const result=supportEmail({conversationId,reason:'Pomoć',transcript});
  expect(result.text).toContain('Pronađite komentar na izvornoj objavi');
  expect(result.text).not.toContain('Preuzmi razgovor');
  expect(result.html).not.toContain('<a href=');expect(result.html).not.toContain('/admin/razgovori');
 }
});
