import {it,expect} from 'vitest';
import {supportEmail} from '@/lib/social/support-email';
it('puts the actual order failure first and uses only Business Suite links',()=>{
 const result=supportEmail({reason:'Komanda /porudzbina',transcript:'RAZLOG: Loyalty članstvo nije povezano bez mejla.\nSto × 1, mikser × 1',customerName:'Test Kupac',inboxUrl:'https://business.facebook.com/latest/inbox/all/?asset_id=123'});
 expect(result.text.indexOf('Loyalty članstvo')).toBeLessThan(result.text.indexOf('Sledeći korak'));
 expect(result.text).toContain('nemojte praviti novu');expect(result.text).toContain('Test Kupac');
 expect(result.html).not.toContain('railway');expect(result.html).not.toContain('<pre');
 expect(supportEmail({reason:'<script>bad</script>',transcript:'&test'}).html).not.toContain('<script>');
});
