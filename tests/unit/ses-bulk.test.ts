import { afterEach, describe, expect, it, vi } from "vitest";
import { SendBulkEmailCommand } from "@aws-sdk/client-sesv2";
import {
  __setSesClientForTests,
  dispatchSesBulk,
} from "@/lib/email/ses";

describe("Amazon SES bulk transport", () => {
  afterEach(() => {
    __setSesClientForTests(null);
  });

  it("uses one personalized destination per recipient", async () => {
    const send = vi.fn().mockResolvedValue({
      BulkEmailEntryResults: [
        { Status: "SUCCESS", MessageId: "ses-1" },
        { Status: "SUCCESS", MessageId: "ses-2" },
      ],
    });
    __setSesClientForTests({ send });

    const result = await dispatchSesBulk(
      {
        from: "Ponude <ponude@svetpovoljnihcena.rs>",
        replyTo: "office@svetpovoljnihcena.rs",
        subject: "Nova ponuda",
        html: '<a href="{{unsubscribeUrl}}">Odjava</a>',
        text: "Odjava: {{unsubscribeUrl}}",
        recipients: [
          { email: "prvi@example.com", templateData: { unsubscribeUrl: "https://example.com/u/1" } },
          { email: "drugi@example.com", templateData: { unsubscribeUrl: "https://example.com/u/2" } },
        ],
        tags: { kind: "newsletter", campaign: "campaign-1" },
      },
      { region: "eu-central-1", configurationSet: "spc-production" },
    );

    expect(result).toEqual({
      ok: true,
      results: [
        { email: "prvi@example.com", ok: true, id: "ses-1", error: null },
        { email: "drugi@example.com", ok: true, id: "ses-2", error: null },
      ],
    });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendBulkEmailCommand);
    expect(command.input).toMatchObject({
      ConfigurationSetName: "spc-production",
      BulkEmailEntries: [
        {
          Destination: { ToAddresses: ["prvi@example.com"] },
          ReplacementEmailContent: {
            ReplacementTemplate: {
              ReplacementTemplateData: JSON.stringify({
                unsubscribeUrl: "https://example.com/u/1",
              }),
            },
          },
        },
        {
          Destination: { ToAddresses: ["drugi@example.com"] },
        },
      ],
    });
  });

  it("surfaces per-recipient failures without losing accepted message ids", async () => {
    __setSesClientForTests({
      send: vi.fn().mockResolvedValue({
        BulkEmailEntryResults: [
          { Status: "SUCCESS", MessageId: "ses-ok" },
          { Status: "ACCOUNT_THROTTLED", Error: "Maximum sending rate exceeded" },
        ],
      }),
    });

    const result = await dispatchSesBulk(
      {
        from: "ponude@svetpovoljnihcena.rs",
        subject: "Ponuda",
        html: "<p>Ponuda</p>",
        text: "Ponuda",
        recipients: [
          { email: "ok@example.com", templateData: {} },
          { email: "retry@example.com", templateData: {} },
        ],
      },
      { region: "eu-central-1", configurationSet: null },
    );

    expect(result).toEqual({
      ok: true,
      results: [
        { email: "ok@example.com", ok: true, id: "ses-ok", error: null },
        {
          email: "retry@example.com",
          ok: false,
          id: null,
          error: "ses:ACCOUNT_THROTTLED Maximum sending rate exceeded",
        },
      ],
    });
  });
});
