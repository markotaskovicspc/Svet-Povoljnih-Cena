import {it,expect,vi,beforeEach} from 'vitest';
const mail=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/email/tracking',()=>({trackedDispatch:mail}));
import {notifyOrderWithoutEmail} from '@/lib/checkout/internal-order-email';
const order={id:'order-1',number:'SPC-TEST',total:3398,shipping:399,items:[{name:'Sto',sku:'TEST',qty:1}]};
beforeEach(()=>mail.mockReset());
it('sends only to the existing orders inbox and reuses one idempotency key',async()=>{
 mail.mockResolvedValue({ok:true,provider:'smtp'});
 await notifyOrderWithoutEmail(order);await notifyOrderWithoutEmail(order);
 for(const [input] of mail.mock.calls){expect(input.to).toBe('porudzbine@svetpovoljnihcena.rs');expect(input.idempotencyKey).toBe('order-no-email:order-1');expect(input.text).toContain('3.398');expect(input.html).toContain('/admin/erp/prodajni-nalozi/order-1');expect(input).not.toHaveProperty('bcc');}
});
it('keeps the durable parent eligible for retry when mail is unavailable',async()=>{
 mail.mockResolvedValue({ok:false,provider:'smtp'});await expect(notifyOrderWithoutEmail(order)).rejects.toThrow('INTERNAL_ORDER_EMAIL_FAILED');
});
