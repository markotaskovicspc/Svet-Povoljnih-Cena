import { beforeEach, expect, it, vi } from 'vitest';
import { shouldAlertTraffic } from '@/lib/analytics/presence';
const m=vi.hoisted(()=>({lock:vi.fn(),read:vi.fn(),save:vi.fn(),count:vi.fn(),subscriptions:vi.fn(),enqueue:vi.fn(),process:vi.fn(),send:vi.fn(),config:vi.fn(),find:vi.fn()}));
const tx={$queryRaw:m.lock,adminSetting:{findUnique:m.read,upsert:m.save},siteVisitorPresence:{count:m.count},adminPushSubscription:{findMany:m.subscriptions}};
vi.mock('@/lib/db',()=>({db:{$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn(tx),adminPushSubscription:{findUnique:m.find}}}));
vi.mock('@/lib/background-jobs',()=>({enqueueBackgroundJob:m.enqueue,processBackgroundJob:m.process}));
vi.mock('@/lib/admin/order-push.server',()=>({getPushConfiguration:m.config,sendAdminDevicePush:m.send}));
import { evaluateTrafficAlert, deliverTrafficPush } from '@/lib/admin/traffic-push.server';
const now=new Date('2026-10-13T20:00:00Z');
beforeEach(()=>{vi.resetAllMocks();m.config.mockReturnValue({});m.lock.mockResolvedValue([{acquired:true}]);m.read.mockResolvedValue(null);m.count.mockResolvedValue(20);m.subscriptions.mockResolvedValue([{id:'s1'}]);m.enqueue.mockResolvedValue({id:'j1'});});
it('uses threshold 20 and sends at most once per hour even while the audience stays high',()=>{
 expect(shouldAlertTraffic(19,null,3600000)).toBe(false);expect(shouldAlertTraffic(20,null,3600000)).toBe(true);
 expect(shouldAlertTraffic(25,1,3600000)).toBe(false);expect(shouldAlertTraffic(20,0,3600000)).toBe(true);
});
it('persists the cooldown and durable device job in the same locked transaction',async()=>{
 await evaluateTrafficAlert(now);expect(m.enqueue.mock.calls[0][1]).toBe(tx);
 expect(m.enqueue.mock.calls[0][0].payload).toEqual({subscriptionId:'s1',count:20,measuredAt:now.toISOString()});
 expect(m.subscriptions.mock.calls[0][0].where.trafficAlerts).toBe(true);
 expect(m.save.mock.calls[0][0].update.value.lastAlertAt).toBe(now.toISOString());expect(m.process).toHaveBeenCalledWith('j1');
});
it('does not fan out when another instance owns the lock or the cooldown is active',async()=>{
 m.lock.mockResolvedValueOnce([{acquired:false}]);await evaluateTrafficAlert(now);expect(m.enqueue).not.toHaveBeenCalled();
 m.read.mockResolvedValue({updatedAt:new Date(now.getTime()-20000),value:{lastAlertAt:new Date(now.getTime()-3599999).toISOString()}});
 await evaluateTrafficAlert(now);expect(m.enqueue).not.toHaveBeenCalled();
});
it('drops stale alerts and respects an opted-out subscription',async()=>{
 await deliverTrafficPush('s1',20,new Date(Date.now()-300001).toISOString());expect(m.send).not.toHaveBeenCalled();
 m.find.mockResolvedValue({trafficAlerts:false});await deliverTrafficPush('s1',20,new Date().toISOString());expect(m.send).not.toHaveBeenCalled();
});
