import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks=vi.hoisted(()=>({upload:vi.fn(),remove:vi.fn(),url:vi.fn()}));
vi.mock("@/lib/admin",()=>({requireAdminAction:async()=>({id:"admin"})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({storage:{from:()=>({upload:mocks.upload,remove:mocks.remove,getPublicUrl:mocks.url})}})}));
import { POST } from "@/app/api/admin/viber-media/route";
beforeEach(()=>{vi.clearAllMocks();mocks.upload.mockResolvedValue({error:null});mocks.url.mockReturnValue({data:{publicUrl:"https://example.com/viber/image.jpg"}})});
it("uploads a complete wide image on an opaque square canvas instead of cropping its center",async()=>{
 const bytes=await sharp({create:{width:1600,height:200,channels:4,background:'#003a85'}}).png().toBuffer();
 const body=new FormData();body.set("file",new File([new Uint8Array(bytes)],"logo.png",{type:"image/png"}));
 const response=await POST(new Request("http://localhost/api/admin/viber-media",{method:"POST",body}));
 expect(response.status).toBe(200);
 const [key,result,options]=mocks.upload.mock.calls[0];
 expect(key).toMatch(/^viber\/.+\.jpg$/);expect(options.contentType).toBe("image/jpeg");
 const m=await sharp(result).metadata();expect(m.width).toBe(1024);expect(m.height).toBe(1024);expect(m.hasAlpha).toBe(false);
 const edge=await sharp(await sharp(result).extract({left:0,top:0,width:1024,height:100}).toBuffer()).stats();
 expect(edge.channels.every(c=>c.mean>250)).toBe(true);
});
it("rejects a forged image without uploading it",async()=>{
 const body=new FormData();body.set("file",new File(["not an image"],"logo.png",{type:"image/png"}));
 expect((await POST(new Request("http://localhost/api/admin/viber-media",{method:"POST",body}))).status).toBe(400);
 expect(mocks.upload).not.toHaveBeenCalled();
});
