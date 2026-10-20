import { expect, it, vi } from "vitest";
import { recordPhonePreferences } from "@/lib/messaging/phone-preferences";
it("records only explicit phone channel choices; an email-only action cannot opt out either phone channel",async()=>{
 const createMany=vi.fn();const tx={auditLog:{createMany}} as never;
 await recordPhonePreferences(tx,"user",{ });expect(createMany).not.toHaveBeenCalled();
 await recordPhonePreferences(tx,"user",{sms:false});
 expect(createMany.mock.calls[0][0].data).toEqual([{action:"messaging.sms.disabled",entity:"User",entityId:"user",diff:{channel:"SMS",enabled:false,source:"account-settings"}}]);
 await recordPhonePreferences(tx,"user",{sms:true,viber:false});
 expect(createMany.mock.calls[1][0].data.map((r:{action:string})=>r.action)).toEqual(["messaging.sms.enabled","messaging.viber.disabled"]);
});
