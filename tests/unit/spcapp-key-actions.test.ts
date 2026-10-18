import {createHash} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),guard:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{partnerApiClient:{create:mocks.create,updateMany:mocks.update}}}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
vi.mock('@/lib/admin',()=>({withAdminState:(meta:unknown,fn:()=>Promise<unknown>)=>{mocks.guard(meta);return fn;}}));
import {createSpcappKey,revokeSpcappKey} from '@/app/admin/erp/spcapp/actions';
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({id:'new-client'});mocks.update.mockResolvedValue({count:1});});
it('creates only a scoped random hash in the DB, returns the secret once and excludes it from audit metadata',async()=>{
 const form=new FormData();form.set('name','SPCApp');
 const result=await createSpcappKey({ok:false,message:''},form) as unknown as {result:{token:string},diff:unknown};
 expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({allowed:['SUPER']}));
 const data=mocks.create.mock.calls[0][0].data;
 expect(data.scopes).toEqual(['spcapp:read']);expect(data.keyHash).toBe(createHash('sha256').update(result.result.token).digest('hex'));
 expect(result.result.token).toMatch(/^spcapp_[a-f0-9]{64}$/);
 expect(JSON.stringify(data)).not.toContain(result.result.token);expect(JSON.stringify(result.diff)).not.toContain(result.result.token);
});
it('restricts revocation to SPCApp clients and SUPER admins',async()=>{
 const form=new FormData();form.set('id','client');
 await revokeSpcappKey({ok:false,message:''},form);
 expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({allowed:['SUPER']}));
 expect(mocks.update).toHaveBeenCalledWith({where:{id:'client',scopes:{has:'spcapp:read'}},data:{enabled:false}});
});
it('does not provision a key for invalid input',async()=>{
 const form=new FormData();form.set('name','');
 const result=await createSpcappKey({ok:false,message:''},form);
 expect(result.ok).toBe(false);expect(mocks.create).not.toHaveBeenCalled();
});
