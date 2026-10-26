import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ account:vi.fn(), signIn:vi.fn(), rate:vi.fn() }));
vi.mock("next-auth",()=>({AuthError:class extends Error{}}));
vi.mock("@/lib/db",()=>({db:{adminUser:{findUnique:mock.account}}}));
vi.mock("@/lib/auth/auth",()=>({signIn:mock.signIn}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error("redirect:"+url)}}));
vi.mock("@/lib/security/rate-limit",()=>({checkRateLimit:mock.rate,getClientIpFromHeaders:()=>"127.0.0.1",rateLimitKey:()=>"key",RATE_LIMITS:{adminLogin:{}}}));
import {loginAction} from "@/app/admin/prijava/actions";
function form(){const data=new FormData();data.set("email","Super@Example.invalid");data.set("password","not-a-real-password");data.set("callbackUrl","/admin/magacin");return data;}
beforeEach(()=>{vi.clearAllMocks();mock.rate.mockResolvedValue({ok:true});mock.signIn.mockResolvedValue(undefined);});
it("switches from warehouse entry to ERP using the new account role",async()=>{
 mock.account.mockResolvedValue({role:"SUPER"});await loginAction(form());
 expect(mock.signIn).toHaveBeenCalledWith("admin-credentials",expect.objectContaining({redirectTo:"/admin/erp",redirect:true}));
 expect(mock.account).toHaveBeenCalledWith({where:{email:"super@example.invalid"},select:{role:true,accessPolicy:true}});
});
it("still authenticates warehouse credentials and returns to warehouse",async()=>{
 mock.account.mockResolvedValue({role:"WAREHOUSE"});await loginAction(form());
 expect(mock.signIn).toHaveBeenCalledWith("admin-credentials",expect.objectContaining({redirectTo:"/admin/magacin"}));
});
it("enforces login rate limits before looking up account roles",async()=>{
 mock.rate.mockResolvedValue({ok:false});await expect(loginAction(form())).rejects.toThrow("redirect:/admin/magacin/prijava?error=1");
 expect(mock.account).not.toHaveBeenCalled();expect(mock.signIn).not.toHaveBeenCalled();
});
