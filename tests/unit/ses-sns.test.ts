import { describe, expect, it } from "vitest";
import {
  isTrustedSnsUrl,
  mapSesEventType,
  snsStringToSign,
  type SnsEnvelope,
} from "@/lib/email/sns";

const envelope: SnsEnvelope = {
  Type: "Notification",
  MessageId: "message-1",
  TopicArn: "arn:aws:sns:eu-central-1:123456789012:ses-events",
  Subject: "Amazon SES Email Event Notification",
  Message: "{\"eventType\":\"Bounce\"}",
  Timestamp: "2026-09-01T10:00:00.000Z",
  SignatureVersion: "2",
  Signature: "signature",
  SigningCertURL:
    "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-test.pem",
};

describe("SES SNS event verification helpers", () => {
  it("builds the AWS canonical notification string in the documented order", () => {
    expect(snsStringToSign(envelope)).toBe(
      `Message\n${envelope.Message}\nMessageId\nmessage-1\nSubject\n${envelope.Subject}\nTimestamp\n${envelope.Timestamp}\nTopicArn\n${envelope.TopicArn}\nType\nNotification\n`,
    );
  });

  it("accepts only trusted SNS certificate and confirmation URLs", () => {
    expect(isTrustedSnsUrl(envelope.SigningCertURL, true)).toBe(true);
    expect(
      isTrustedSnsUrl(
        "https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
      ),
    ).toBe(true);
    expect(
      isTrustedSnsUrl(
        "https://sns.eu-central-1.amazonaws.com.evil.example/SimpleNotificationService-test.pem",
        true,
      ),
    ).toBe(false);
    expect(isTrustedSnsUrl("http://sns.eu-central-1.amazonaws.com/test", true)).toBe(
      false,
    );
  });

  it("maps SES events to the existing provider event vocabulary", () => {
    expect(mapSesEventType("Bounce")).toBe("email.bounced");
    expect(mapSesEventType("Complaint")).toBe("email.complained");
    expect(mapSesEventType("Delivery")).toBe("email.delivered");
    expect(mapSesEventType("Rendering Failure")).toBe("email.failed");
    expect(mapSesEventType("unknown")).toBeNull();
  });
});
