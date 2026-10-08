import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ transaction: vi.fn(), claim: vi.fn(), receipt: vi.fn(), parcels: vi.fn(), adjust: vi.fn(), update: vi.fn(), balance: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: m.transaction } }));
vi.mock('@/lib/inventory', () => ({ adjustInventory: m.adjust, ensureDefaultWarehouse: vi.fn() }));
vi.mock('@/lib/fiscal/return-lock', () => ({ lockOrderReturn: vi.fn() }));
vi.mock('@/lib/fiscal/return-stock', () => ({ returnedStockBalance: m.balance }));
vi.mock('@/lib/admin/return-resolution.server', () => ({ assertReturnNotLost: vi.fn() }));
vi.mock('@/lib/courier/registry', () => ({ createShipmentForOrder: vi.fn(), preflightShipmentForOrder: vi.fn() }));
vi.mock('@/lib/mygls/shipments', () => ({ deleteMyGlsLabelsForShipment: vi.fn(), ensureMyGlsReturnDocument: vi.fn() }));
vi.mock('@/lib/x-express/shipments', () => ({ announceXExpressShipment: vi.fn() }));
import { receiveReclamationReturn } from '@/lib/admin/reclamation-fulfillment.server';
const claim = { id: 'r', orderId: 'o', number: 'R1', sku: 'chair', productId: 'p', orderItemId: 'i', quantity: 2, status: 'PRIMLJENO', shipments: [{
  id: 's', provider: 'MYGLS', packageCount: 2, status: 'DELIVERED', providerParcelNumbers: [9002838514, 9002838515],
  returnArrivals: [{ parcelNumber: '9002838514' }],
  rawCreateResponse: { myGlsPackageAssignments: [{ orderItemId: 'i', parcelNumber: 9002838514, packedQuantity: 1 }, { orderItemId: 'i', parcelNumber: 9002838515, packedQuantity: 1 }] },
}] };
const tx = { $queryRaw: vi.fn(), reclamation: { findUnique: m.claim, update: m.update }, warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'w', active: true, code: 'MAG', name: 'Povrati' }) }, stockMovement: { findUnique: m.receipt, findMany: m.parcels }, warehouseStock: { findFirst: vi.fn().mockResolvedValue({ id: 'stock' }) } };
const input = { reclamationId: 'r', parcelNumber: '09002838514', warehouseId: 'w', actorId: 'admin' };
beforeEach(() => { vi.clearAllMocks(); m.transaction.mockImplementation(run => run(tx)); m.claim.mockResolvedValue(claim); m.receipt.mockResolvedValue(null); m.parcels.mockResolvedValue([]); m.balance.mockResolvedValue({ refunded: 0 }); m.adjust.mockResolvedValue({ id: 'receipt', qty: 1 }); });
describe('partial reclamation receipt', () => {
  it('receives physically scanned P1 without waiting for P2 and keeps the claim incomplete', async () => {
    await receiveReclamationReturn(input);
    expect(m.adjust).toHaveBeenCalledWith(tx, expect.objectContaining({ qtyDelta: 1, idempotencyKey: 'reclamation-return:r:parcel:9002838514' }));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ warehouseStatus: undefined }) }));
  });
  it('does not repost the same parcel or an old whole-claim receipt', async () => {
    m.parcels.mockResolvedValue([{ idempotencyKey: 'reclamation-return:r:parcel:9002838514', qty: 1 }]);
    await receiveReclamationReturn(input); expect(m.adjust).not.toHaveBeenCalled();
    m.parcels.mockResolvedValue([]); m.receipt.mockResolvedValue({ qty: 2 });
    await receiveReclamationReturn(input); expect(m.adjust).not.toHaveBeenCalled();
  });
  it('completes only after both physically received parcel quantities are posted', async () => {
    m.claim.mockResolvedValue({ ...claim, shipments: [{ ...claim.shipments[0], returnArrivals: [{ parcelNumber: '9002838514' }, { parcelNumber: '9002838515' }] }] });
    m.parcels.mockResolvedValue([{ idempotencyKey: 'reclamation-return:r:parcel:9002838514', qty: 1 }]);
    await receiveReclamationReturn({ ...input, parcelNumber: '09002838515' });
    expect(m.adjust).toHaveBeenCalledWith(tx, expect.objectContaining({ qtyDelta: 1 }));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ warehouseStatus: 'READY' }) }));
  });
  it('blocks posting a second stock increase after fiscal return', async () => {
    m.balance.mockResolvedValue({ refunded: 1 });
    await expect(receiveReclamationReturn(input)).rejects.toThrow('fiskalnu');
    expect(m.adjust).not.toHaveBeenCalled();
  });
});
