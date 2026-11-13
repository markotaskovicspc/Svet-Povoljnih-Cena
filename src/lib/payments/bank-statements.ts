import {z} from 'zod';

export const bankEntrySchema=z.object({
 account:z.literal('340000100028300451'),statement:z.string().regex(/^\d{1,8}$/),
 date:z.iso.date(),bankReference:z.string().regex(/^FT[A-Z0-9]{8,30}$/),
 orderNumber:z.string().regex(/^SPC-\d{4}-\d{6}$/),
 amountMinor:z.number().int().positive().max(999999999999),currency:z.literal('RSD'),
 sourceHash:z.string().regex(/^[a-f0-9]{64}$/),
});
export type BankEntry=z.infer<typeof bankEntrySchema>;
export function bankEntryKey(entry:BankEntry){return `bank-credit:${entry.account}:${entry.bankReference}`;}
/** Credit without a readable PBO order number: support review only, never an automatic payment. */
export const bankUnmatchedSchema=bankEntrySchema.omit({orderNumber:true}).extend({
 reason:z.enum(['SPC_UNREADABLE','SPC_MISSING','SPC_NOT_IN_REFERENCE']),
 suggestedOrderNumber:z.string().regex(/^SPC-\d{4}-\d{6}$/).optional(),
});
export type BankUnmatched=z.infer<typeof bankUnmatchedSchema>;
export function bankUnmatchedKey(entry:BankUnmatched){return `bank-unmatched:${entry.account}:${entry.bankReference}`;}
export function bankPaymentDecision(order:null|{paymentMethod:string;status:string;totalMinor:number;stockRestoredAt:unknown;cancelledAt:unknown;payments:Array<{status:string}>},entry:BankEntry){
 if(!order)return 'ORDER_NOT_FOUND';
 if(order.paymentMethod!=='UPLATA_NA_RACUN')return 'PAYMENT_METHOD_MISMATCH';
 if(order.stockRestoredAt||order.cancelledAt||['OTKAZANO','VRACENO'].includes(order.status))return 'ORDER_CANCELLED_OR_RETURNED';
 if(order.payments.some(p=>['PAID','REFUNDED','PARTIAL_REFUND','AUTHORIZED'].includes(p.status)))return 'PAYMENT_ALREADY_RECORDED';
 if(order.totalMinor!==entry.amountMinor)return 'AMOUNT_MISMATCH';
 return 'MATCHED';
}
