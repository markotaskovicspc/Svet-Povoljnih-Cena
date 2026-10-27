import 'server-only';
import { exportDeliveredArticles } from './delivered-articles.server';
import { exportReclamations } from './reclamations.server';
import { type ExportQuery } from './contract';
import { exportProducts, exportInventory, exportPrices, exportLoyaltyRules, exportPromotions, exportPurchaseOrders, exportInboundInvoices } from './catalog.server';
import { exportOrders, exportAnanasOrders, exportFiscal, exportAnanasFiscal, exportLegacyFiscal } from './sales.server';
import { exportShipments, exportCourierStatements, exportSef } from './logistics.server';
import { exportTraffic, exportCustomers, exportPerformance } from './metrics.server';
export function exportResource(q: ExportQuery): Promise<{ id: string }[]> {
  switch (q.resource) {
    case 'delivered-articles': return exportDeliveredArticles(q);
    case 'reclamations':
    case 'spc-reclamations': return exportReclamations(q);
    case 'orders': return exportOrders(q);
    case 'ananas-orders': return exportAnanasOrders(q);
    case 'fiscal-documents': return exportFiscal(q);
    case 'ananas-fiscal-documents': return exportAnanasFiscal(q);
    case 'legacy-fiscal-receipts': return exportLegacyFiscal(q);
    case 'products': return exportProducts(q);
    case 'inventory': return exportInventory(q);
    case 'prices': return exportPrices(q);
    case 'loyalty-rules': return exportLoyaltyRules(q);
    case 'promotions': return exportPromotions(q);
    case 'purchase-orders': return exportPurchaseOrders(q);
    case 'inbound-invoices':
    case 'goods-receipts': return exportInboundInvoices(q);
    case 'shipments': return exportShipments(q);
    case 'courier-statements': return exportCourierStatements(q);
    case 'sef-invoices': return exportSef(q);
    case 'traffic': return exportTraffic(q);
    case 'customers': return exportCustomers(q);
    case 'product-performance': return exportPerformance(q);
  }
}
