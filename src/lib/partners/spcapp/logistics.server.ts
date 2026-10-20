import {shipmentExportReferences} from './shipment-references';
import 'server-only';
import { DOMParser } from '@xmldom/xmldom';
import { db } from '@/lib/db';
import { readInvoiceXml } from '@/lib/sef/ubl';
import { type ExportQuery, money, ExportInputError } from './contract';

export async function exportShipments(q: ExportQuery) {
  const rows = await db.shipment.findMany({ where: { id: { gt: q.after }, createdAt: { gte: q.period.start, lt: q.period.endExclusive } }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, orderId: true, provider: true, service: true, trackingNo: true, providerOrderId: true, providerParcelNumbers: true, purpose: true, status: true, packageCount: true, codAmount: true, createdAt: true, updatedAt: true, shippedAt: true, deliveredAt: true,
      pickupBatchLines: { select: { id: true, batchId: true, orderItemId: true, packedQuantity: true, packageNo: true, providerParcelNumber: true, weightKg: true, widthCm: true, depthCm: true, heightCm: true, courierPickedUpAt: true, providerLabelCancelledAt: true } },
      order: { select: { number: true, invoices: { select: { id: true, number: true, kind: true, status: true } },
        fiscalDocuments: { where: { status: 'ISSUED' }, select: { id: true, receiptNumber: true, kind: true, issuedAt: true, lines: { where: { sku: 'DOSTAVA' }, select: { totalGross: true, totalNet: true } } } } } } } });
  return rows.map(({ order, ...row }) => ({ ...row, ...shipmentExportReferences(row), orderNumber: order.number, invoices: order.invoices,
    fiscalDocuments: order.fiscalDocuments.map(({ lines, ...doc }) => ({ ...doc,
      orderShippingGross: money((doc.kind === 'REFUND' ? -1 : 1) * lines.reduce((sum, line) => sum + Number(line.totalGross), 0)),
      orderShippingNet: money((doc.kind === 'REFUND' ? -1 : 1) * lines.reduce((sum, line) => sum + Number(line.totalNet), 0)),
    })), shippingAllocation: 'ORDER_TOTAL_REPEATED_PER_SHIPMENT_DEDUPLICATE_BY_FISCAL_DOCUMENT_ID',
  }));
}
export async function exportCourierStatements(q: ExportQuery) {
  return db.courierStatement.findMany({ where: { id: { gt: q.after }, createdAt: { gte: q.period.start, lt: q.period.endExclusive } }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, provider: true, documentNo: true, filename: true, createdAt: true,
      lines: { select: { id: true, lineKey: true, kind: true, trackingNo: true, orderNumber: true, bookedOn: true, amountNet: true, amountGross: true, weightKg: true, shipmentId: true } } } });
}
export function sefDetails(xml: string) {
  try {
    const parsed = readInvoiceXml(xml);
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    const period = dom.getElementsByTagNameNS('urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2', 'InvoicePeriod').item(0);
    const date = (name: string) => period?.getElementsByTagNameNS('urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', name).item(0)?.textContent?.trim() || null;
    return { parsed, periodFrom: date('StartDate'), periodTo: date('EndDate'), error: null };
  } catch { return { parsed: null, periodFrom: null, periodTo: null, error: 'XML_ATTACHMENT_PARSE_FAILED' }; }
}
export async function exportSef(q: ExportQuery) {
  const rows = await db.sefDocument.findMany({ where: { id: { gt: q.after }, direction: 'IN', issueDate: { gte: q.period.start, lt: q.period.endExclusive }, ...(q.supplierPib ? { supplierPib: q.supplierPib } : {}) },
    orderBy: { id: 'asc' }, take: q.limit + 1, select: { id: true, environment: true, remoteId: true, number: true, supplierName: true, supplierPib: true, issueDate: true, dueDate: true, net: true, vat: true, gross: true, currency: true, status: true, xml: true, updatedAt: true } });
  return rows.map(({ xml, ...row }) => {
    const details = sefDetails(xml);
    return { ...row, periodFrom: details.periodFrom, periodTo: details.periodTo, attachmentError: details.error,
      attachments: details.parsed?.attachments.map(attachment => ({ index: attachment.index, filename: attachment.filename, mime: attachment.mime,
        downloadPath: `/api/partners/v1/spcapp/sef-attachment?documentId=${encodeURIComponent(row.id)}&index=${attachment.index}` })) ?? [],
      specificationLines: null, specificationStatus: 'ATTACHMENTS_AVAILABLE_NOT_STRUCTURALLY_PARSED', courierStatementId: null,
    };
  });
}
export async function downloadSefAttachment(url: URL) {
  if ([...url.searchParams.keys()].some(key => !['documentId', 'index'].includes(key)) || url.searchParams.getAll('documentId').length !== 1 || url.searchParams.getAll('index').length !== 1) throw new ExportInputError('Expected documentId and index.');
  const documentId = url.searchParams.get('documentId') ?? '', index = url.searchParams.get('index') ?? '';
  if (!documentId || documentId.length > 100 || !/^\d{1,4}$/.test(index)) throw new ExportInputError('Invalid attachment.');
  const doc = await db.sefDocument.findFirst({ where: { id: documentId, direction: 'IN' }, select: { xml: true } });
  const file = doc ? sefDetails(doc.xml).parsed?.attachments[Number(index)] : null;
  if (!file) return null;
  return { bytes: Buffer.from(file.base64, 'base64'), filename: file.filename, mime: file.mime };
}
