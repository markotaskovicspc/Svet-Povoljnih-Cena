# Comments to private conversations

New top-level Facebook Page and Instagram media comments arrive on the same signed Meta webhook as inbox messages. Posts are read from Meta and relevant products searched in the ERP. There is no automatic order creation from a public comment. Replies to other commenters, self-comments, edits, empty and expired events are ignored.

The AI classifies sales questions, support cases and non-actionable comments. It can only read the catalogue/specifications. Sales questions get one private reply; only a confirmed successful private send gets the fixed public acknowledgement (no public price). Support cases are sent once to the existing support email integration. Other comments are skipped.

The private reply and original comment become context in the existing conversation. A private reply never opens the normal 24-hour response window: only an actual incoming customer message does. An existing manual pause or active inbox conversation is preserved. Limit: one initial private reply per sender/account in 24 hours, and at most 600 initial send attempts per account per hour. No catch-up of comments made before channel activation. Ambiguous sends are marked uncertain for human inspection, never automatically repeated.

## Activation

1. Verify the existing Meta app token grants comment permissions. Facebook needs permission to read Page/user comments and publish replies (pages_read_engagement, pages_read_user_content where required, pages_manage_engagement), in addition to pages_messaging and pages_manage_metadata. Instagram needs the comment permissions for its configured login type plus existing messaging permission. Complete Meta review where required.
2. Subscribe the Page/app to `feed` and Instagram to `comments`, preserving all existing messaging subscriptions. Existing callback and app secret remain the same.
3. Set META_APP_ID to the verified app ID. Echoes from that exact application are recognized before send receipts arrive. Other app/staff echoes still pause the bot.
4. Set COMMENTS_ENABLED=true (BOT_ENABLED must also be true). Channels still default to disabled.
5. Enable the verified channel through the authenticated operator panel or POST /admin/comments/settings with {channel: 'facebook' | 'instagram', enabled: true}. A new activation timestamp is recorded on every false→true transition. Disabling suppresses queued unsent work; it does not remove published replies.

GET /admin/comments returns channel switches and latest status metadata. `failed` means Meta explicitly rejected the private send, `uncertain` requires checking the actual inbox before doing anything, and `review` needs operator attention. Public failures never repeat the private send. Do not replay uncertain or old events.

Run `node --test test/comments.test.mjs test/http.test.mjs test/security.test.mjs` and `node --env-file=.env.local scripts/comments-smoke.mjs` (synthetic input/mock ERP only). Never use a real customer comment as a test.
