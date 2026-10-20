import { afterEach, expect, it, vi } from "vitest";
import { smsSegments } from "@/lib/messaging/sms";
import { buildNthSmsPayload } from "@/lib/viber/nth";
import { audienceFormFilter } from "@/lib/viber/ui";
import { editMessageWithAi } from "@/lib/messaging/ai";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("counts GSM extensions, multipart boundaries, Cyrillic and surrogate pairs", () => {
 expect(smsSegments('a'.repeat(160))).toMatchObject({parts:1,encoding:'GSM-7'});
 expect(smsSegments('a'.repeat(161))).toMatchObject({parts:2});
 expect(smsSegments('^'.repeat(81))).toMatchObject({units:162,parts:2});
 expect(smsSegments('č'.repeat(70))).toMatchObject({parts:1,encoding:'Unicode'});
 expect(smsSegments('č'.repeat(71))).toMatchObject({parts:2});
 expect(smsSegments('😀'.repeat(36))).toMatchObject({units:72,parts:2});
});
it("builds an SMS-only request with registered sender and rejects rich media without an artificial SMS part cap", () => {
 const m=buildNthSmsPayload({to:'0637725045',text:'Test',requestId:'sms-test'},'SvetPovCena');
 expect(m).toMatchObject({channels:['SMS'],destinations:[{phoneNumber:'381637725045'}],sms:{sender:'SvetPovCena',text:'Test'},dlr:false});
 expect(m).not.toHaveProperty('viber');
 expect(()=>buildNthSmsPayload({to:'0637725045',text:'Test',imageUrl:'https://example.com/image.png'})).toThrow();
 expect(buildNthSmsPayload({to:'0637725045',text:'č'.repeat(403)}).sms.text).toHaveLength(403);
});
it("keeps current SMS audiences separate from the dated Viber audience", () => {
 expect(audienceFormFilter({name:'Svi',allStoredPhones:true,channel:'SMS'})).toEqual({channel:'SMS',allStoredPhones:true,phoneScope:'current'});
 expect(audienceFormFilter({name:'SMS saglasnosti',channel:'SMS'})).toEqual({channel:'SMS',includeNonCustomers:true});
});
it("asks AI for text only, without sending audience data, and disables response storage", async () => {
 vi.stubEnv('OPENAI_API_KEY','test-key');
 const fetch=vi.fn().mockResolvedValue(Response.json({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'Cena 999 RSD. https://example.com {ime}'}]}]}));
 vi.stubGlobal('fetch',fetch);
 expect(await editMessageWithAi({channel:'SMS',body:'Cena 999 RSD. https://example.com {ime}',instruction:'Skrati'})).toContain('999');
 const request=JSON.parse(fetch.mock.calls[0][1].body);
 expect(request.store).toBe(false);expect(request.input).not.toContain('phoneNumber');expect(fetch.mock.calls[0][1].redirect).toBe('error');
});
it("rejects AI edits that change protected prices/links and rejects partial responses", async () => {
 vi.stubEnv('OPENAI_API_KEY','test-key');
 const fetch=vi.fn().mockResolvedValue(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Cena 499 RSD.'}]}]}));
 vi.stubGlobal('fetch',fetch);
 await expect(editMessageWithAi({channel:'VIBER',body:'Cena 999 RSD.',instruction:'Skrati'})).rejects.toThrow('sve brojeve');
 fetch.mockResolvedValue(Response.json({status:'incomplete',output:[]}));
 await expect(editMessageWithAi({channel:'SMS',body:'Test',instruction:'Skrati'})).rejects.toThrow('potpun');
});
