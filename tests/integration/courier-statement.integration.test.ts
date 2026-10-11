import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { importStatement, statementIdentity } from "@/lib/courier/finance.server";

it("imports a real PostgreSQL statement transaction and makes a repeated import a no-op", async () => {
  const runId = `${Date.now()}-${process.pid}`;
  const input = {
    provider: "MYGLS" as const,
    documentNo: `QA-COURIER-${runId}`,
    filename: "qa.csv",
    rows: [{ kind: "COST" as const, trackingNo: `QA-PARCEL-${runId}`, bookedOn: "2026-09-30", amount: 354, vatIncluded: false }],
  };
  const fingerprint = statementIdentity(input).fingerprint;
  try {
    const result = await importStatement(input, fingerprint, "integration-test");
    expect(result).toMatchObject({ alreadyImported: false, matched: 0 });
    const saved = await db.courierStatement.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    expect(saved.lines).toHaveLength(1);
    expect(Number(saved.lines[0].amountNet)).toBe(354);
    expect(Number(saved.lines[0].amountGross)).toBe(424.8);
    expect(saved.lines[0].bookedOn.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect((await importStatement(input, fingerprint, "integration-test")).alreadyImported).toBe(true);
    expect(await db.courierStatementLine.count({ where: { statementId: result.id } })).toBe(1);
  } finally {
    await db.courierStatement.deleteMany({ where: { provider: "MYGLS", documentNo: input.documentNo } });
  }
});
