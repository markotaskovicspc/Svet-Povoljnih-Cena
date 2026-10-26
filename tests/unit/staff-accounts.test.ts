import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mock = vi.hoisted(() => ({
  admin: vi.fn(), create: vi.fn(), update: vi.fn(), hash: vi.fn(), audit: vi.fn(), finalize: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { adminUser: { create: mock.create, updateMany: mock.update } } }));
vi.mock("bcryptjs", () => ({ default: { hash: mock.hash } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mock.admin }));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: vi.fn() }));
vi.mock("@/lib/admin/audit", () => ({ logAudit: mock.audit, finalizeAudit: mock.finalize }));
vi.mock("@/lib/admin", async () => ({ withAdminState: (await import("@/lib/admin/guard")).withAdminState }));

import { createOperator, createStaffAccount, setStaffAccountEnabled, updateStaffAccountAccess } from "@/app/admin/erp/operativci/actions";

const state = { ok: false, message: "" };
const secret = "safe password 123";
const selected = ["/admin/viber", "/admin/erp/artikli"];
function createForm(modules = selected, password = secret) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ firstName: "Milan", lastName: "Test", email: " Milan@example.invalid ", password })) form.set(key, value);
  modules.forEach(key => form.append("modules", key));
  return form;
}
function targetForm(id = "staff", modules = selected) {
  const form = new FormData(); form.set("id", id); form.set("enabled", "false");
  modules.forEach(key => form.append("modules", key));
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.admin.mockResolvedValue({ id: "super", role: "SUPER" });
  mock.create.mockResolvedValue({ id: "new-staff" }); mock.update.mockResolvedValue({ count: 1 });
  mock.hash.mockResolvedValue("HASH"); mock.audit.mockResolvedValue({ id: "attempt" }); mock.finalize.mockResolvedValue(undefined);
});

describe("staff account permissions and credential boundary", () => {
  it.each([null, "OPS", "CONTENT", "ADS", "WAREHOUSE", "CUSTOM"])("rejects %s from SUPER account actions before audit, hashing or writes", async role => {
    mock.admin.mockResolvedValue(role ? { id: "other", role, accessPolicy: { version: 1, modules: selected } } : null);
    await expect(createStaffAccount(state, createForm())).rejects.toThrow("redirect:");
    await expect(updateStaffAccountAccess(state, targetForm())).rejects.toThrow("redirect:");
    await expect(setStaffAccountEnabled(state, targetForm())).rejects.toThrow("redirect:");
    expect(mock.hash).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled(); expect(mock.audit).not.toHaveBeenCalled();
  });

  it("creates a CUSTOM account with multiple exact module keys and no role escalation", async () => {
    const form = createForm(); form.set("role", "SUPER");
    const result = await createStaffAccount(state, form);
    expect(result.ok).toBe(true);
    expect(mock.hash).toHaveBeenCalledWith(secret, 12);
    expect(mock.create).toHaveBeenCalledWith({ data: {
      firstName: "Milan", lastName: "Test", email: "milan@example.invalid", passwordHash: "HASH", role: "CUSTOM",
      accessPolicy: { version: 1, modules: [...selected].sort() },
    }, select: { id: true } });
    const output = JSON.stringify([result, mock.audit.mock.calls, mock.finalize.mock.calls]);
    expect(output).not.toContain(secret); expect(output).not.toContain("HASH");
  });

  it("uses the warehouse login role only for an exclusively warehouse policy", async () => {
    expect((await createStaffAccount(state, createForm(["/admin/magacin"]))).ok).toBe(true);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      role: "WAREHOUSE", accessPolicy: { version: 1, modules: ["/admin/magacin"] },
    }) }));
    mock.create.mockClear();
    await createStaffAccount(state, createForm(["/admin/magacin", "/admin/viber"]));
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "CUSTOM" }) }));
  });

  it.each([[], ["SUPER"], ["/admin/erp/operativci"], ["/admin/audit-log"], ["https://attacker.test/admin"], ["/admin/viber", "UNKNOWN"]].map(modules => ({ modules })))("rejects missing, reserved or unknown modules before processing credentials: %j", async ({ modules }) => {
    expect((await createStaffAccount(state, createForm(modules))).ok).toBe(false);
    expect(mock.hash).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
  });

  it.each(["short", " ".repeat(12), "a".repeat(73), "ž".repeat(37), ` ${secret}`, `${secret} `])("rejects unsafe/truncated credentials without exposing them", async password => {
    expect((await createStaffAccount(state, createForm(selected, password))).ok).toBe(false);
    expect(mock.hash).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
    expect(JSON.stringify(mock.finalize.mock.calls)).not.toContain(password);
  });

  it("accepts a password exactly 72 UTF-8 bytes long", async () => {
    const password = "ž".repeat(36);
    expect((await createStaffAccount(state, createForm(selected, password))).ok).toBe(true);
    expect(mock.hash).toHaveBeenCalledWith(password, 12);
  });

  it("does not expose credential material echoed by a DB exception", async () => {
    mock.create.mockRejectedValue(new Error(`failed ${secret} HASH`));
    const result = await createStaffAccount(state, createForm());
    expect(result.ok).toBe(false);
    const output = JSON.stringify([result, mock.finalize.mock.calls]);
    expect(output).not.toContain(secret); expect(output).not.toContain("HASH");
  });

  it("returns a safe duplicate-email message", async () => {
    mock.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate HASH", { code: "P2002", clientVersion: "test" }));
    expect(await createStaffAccount(state, createForm())).toMatchObject({ ok: false, message: "Nalog sa tom e-poštom već postoji." });
    expect(JSON.stringify(mock.finalize.mock.calls)).not.toContain("HASH");
  });

  it("updates a non-SUPER target to the selected policy, independent of forged form fields", async () => {
    const form = targetForm(); form.set("role", "SUPER"); form.set("passwordHash", "INJECTED");
    expect((await updateStaffAccountAccess(state, form)).ok).toBe(true);
    expect(mock.update).toHaveBeenCalledWith({
      where: { id: "staff", NOT: { id: "super" }, role: { not: "SUPER" } },
      data: { role: "CUSTOM", accessPolicy: { version: 1, modules: [...selected].sort() } },
    });
    expect(mock.hash).not.toHaveBeenCalled();
    expect(JSON.stringify(mock.finalize.mock.calls)).not.toContain("INJECTED");
  });

  it("updates a target to WAREHOUSE when only the warehouse remains", async () => {
    await updateStaffAccountAccess(state, targetForm("staff", ["/admin/magacin"]));
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      role: "WAREHOUSE", accessPolicy: { version: 1, modules: ["/admin/magacin"] },
    } }));
  });

  it("rejects self edits and does not modify SUPER targets", async () => {
    expect((await updateStaffAccountAccess(state, targetForm("super"))).ok).toBe(false);
    expect((await setStaffAccountEnabled(state, targetForm("super"))).ok).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
    mock.update.mockResolvedValue({ count: 0 });
    expect((await updateStaffAccountAccess(state, targetForm("another-super"))).ok).toBe(false);
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: { not: "SUPER" } }) }));
  });

  it.each(["true", "false"])("constrains enabled=%s to non-SUPER targets excluding the actor", async enabled => {
    const form = targetForm(); form.set("enabled", enabled);
    expect((await setStaffAccountEnabled(state, form)).ok).toBe(true);
    expect(mock.update).toHaveBeenCalledWith({
      where: { id: "staff", NOT: { id: "super" }, role: { not: "SUPER" } }, data: { enabled: enabled === "true" },
    });
  });

  it.each(["", "yes", "0"])("rejects malformed enabled=%s without writing", async enabled => {
    const form = targetForm(); form.set("enabled", enabled);
    expect((await setStaffAccountEnabled(state, form)).ok).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("keeps legacy OPS creation fixed to WAREHOUSE without trusting injected modules", async () => {
    mock.admin.mockResolvedValue({ id: "ops", role: "OPS" });
    expect((await createOperator(state, createForm())).ok).toBe(true);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      firstName: "Milan", lastName: "Test", email: "milan@example.invalid", passwordHash: "HASH", role: "WAREHOUSE",
    } }));
  });

  it("does not write when the required attempt audit cannot be saved", async () => {
    mock.audit.mockRejectedValue(new Error("audit unavailable"));
    expect(await createStaffAccount(state, createForm())).toMatchObject({ ok: false, message: expect.stringContaining("audit zapis") });
    expect(mock.hash).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
  });
});
