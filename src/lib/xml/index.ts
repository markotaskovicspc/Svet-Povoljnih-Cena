/**
 * Phase 4A — XML supplier feed module.
 *
 * Public surface intentionally narrow: the importer + reservation hook
 * cover every entry-point downstream code needs. Internals (parser,
 * connector, mapper) are still importable directly for tests.
 */

export type {
  FeedItem,
  FeedAction,
  FeedMaterial,
  FeedMedia,
  FeedPictogram,
  ImportSummary,
  SupplierConfig,
  SupplierConnector,
  SupplierFeedMapping,
} from "./types";

export { parseXml, resolvePath, findAll } from "./parser";
export { mapXmlToFeed, HttpXmlConnector, connectorFor } from "./connector";
export { importSupplier, importAllSuppliers } from "./import";
export { notifySuppliersOfReservation } from "./reservation";
export type { ReservationRequest, ReservationLine } from "./reservation";
export { getSupplierHealth, getLatestStockSnapshots } from "./health";
export type { SupplierHealth } from "./health";
