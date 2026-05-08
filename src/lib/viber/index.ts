/**
 * Phase 4E — public surface of the Viber broadcasts module.
 */
export { getViberConfig, type ViberConfig, type ViberProvider } from "./config";
export { dispatch, type ViberMessage, type ViberDispatchResult } from "./transport";
export {
  audienceFilterSchema,
  parseAudienceFilter,
  resolveAudience,
  countAudience,
  type AudienceFilter,
  type AudienceRecipient,
} from "./audience";
export {
  campaignDraftSchema,
  audienceDraftSchema,
  saveAudience,
  saveCampaign,
  sendCampaign,
  failCampaign,
  runDueCampaigns,
  type CampaignDraftInput,
  type AudienceDraftInput,
  type SendOptions,
  type SendReport,
} from "./campaign";
export {
  inboundEventSchema,
  parseTracking,
  applyInboundEvent,
  type InboundEvent,
  type CampaignAttribution,
  type ReportResult,
} from "./inbound";
