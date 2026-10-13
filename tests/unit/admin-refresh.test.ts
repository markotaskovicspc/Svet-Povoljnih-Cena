import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),tag:vi.fn(),path:vi.fn()}));
vi.mock('@/lib/admin',()=>({requireAdminAction:m.auth}));vi.mock('next/cache',()=>({updateTag:m.tag,revalidatePath:m.path}));
import { refreshAdminData } from '@/app/admin/refresh-action';
beforeEach(()=>vi.resetAllMocks());
it('refreshes authenticated admin data and its analytics cache without changing filters',async()=>{
 await refreshAdminData('/admin/erp/performans-artikala');expect(m.tag).toHaveBeenCalledWith('admin-dashboard-analytics');expect(m.path).toHaveBeenCalledWith('/admin/erp/performans-artikala');
});
it('rejects guests and paths outside admin before invalidating data',async()=>{
 m.auth.mockRejectedValueOnce(new Error('Unauthorized'));await expect(refreshAdminData('/admin')).rejects.toThrow('Unauthorized');
 for(const path of ['https://other.example/admin','/shop','/admin/../shop','/admin?token=private'])await expect(refreshAdminData(path)).rejects.toThrow();
 expect(m.tag).not.toHaveBeenCalled();expect(m.path).not.toHaveBeenCalled();
});

it('allows warehouse refresh only through the warehouse guard and leaves unrelated analytics cache intact',async()=>{
 await refreshAdminData('/admin/magacin/povrat');expect(m.auth).toHaveBeenCalledWith(['WAREHOUSE','OPS']);expect(m.tag).not.toHaveBeenCalled();expect(m.path).toHaveBeenCalledWith('/admin/magacin/povrat');
});
