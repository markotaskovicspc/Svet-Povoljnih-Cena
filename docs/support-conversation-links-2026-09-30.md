# Support email conversation links

Meta Graph `conversation.link` contains a legacy/scoped conversation identifier. It is not a valid source for Business Suite `selected_item_id`. Opening the original Graph URL also reproduced the broken thread, so changing only the URL format is insufficient.

New support notifications use the authenticated SPC panel as their exact conversation link. They also include the Page's generic Business Suite inbox and the sender's name (when the Graph participant lookup succeeds), so staff can search in the mobile app. No operator key is included in email URLs.

The worker discards legacy `state.inboxLink` caches before dispatch. Only `state.verifiedInboxLink`, explicitly saved by an authenticated operator after opening and verifying the recipient in Business Suite, may be used for an exact Meta link. The protected `set_inbox_link` admin action checks the Page scope and URL shape; the operator must check the recipient. IDs cannot be inferred from a PSID or Graph conversation link.

Already received emails are unchanged. Mobile app handling of verified web URLs still depends on Meta and has not been validated on a physical phone.

Validation: mocked ERP email rendering and escaping, rejection of unsafe destinations, legacy cache removal, Graph lookup failure fallback, admin authentication and Page-scope checks. No test support email or customer message is sent.
