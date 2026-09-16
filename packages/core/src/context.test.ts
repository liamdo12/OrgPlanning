import { describe, expect, it } from "vitest";
import { CoreContextError, createCoreContext } from "./context.js";
import { createTestCoreContext } from "./testing.js";

const productionConfig = {
  appTier: "production",
  allowClockOverride: false,
  allowDestructiveSeed: false,
  commissionBps: 1000,
  hstBps: 1300,
  currency: "CAD",
} as const;

describe("createCoreContext", () => {
  it("builds a usable context with no environment variables set", () => {
    const ctx = createTestCoreContext();

    expect(ctx.config.appTier).toBe("local");
    expect(ctx.config.currency).toBe("CAD");
    expect(ctx.clock.now().toISOString()).toBe("2026-09-15T12:00:00.000Z");
    expect(ctx.stripe.mode()).toBe("test");
  });

  it("refuses a production tier that carries a clock override", () => {
    expect(() =>
      createTestCoreContext({
        config: { ...productionConfig, allowClockOverride: true },
      }),
    ).toThrow(CoreContextError);
  });

  it("refuses a production tier that allows a destructive reseed", () => {
    expect(() =>
      createTestCoreContext({
        config: { ...productionConfig, allowDestructiveSeed: true },
      }),
    ).toThrow(/allowDestructiveSeed/);
  });

  it("allows the demo tier to keep the override, which is why the tier exists", () => {
    const ctx = createTestCoreContext({
      config: { ...productionConfig, appTier: "demo", allowClockOverride: true },
    });

    expect(ctx.config.allowClockOverride).toBe(true);
  });

  it("freezes the config so a validated tier cannot be re-enabled afterwards", () => {
    const ctx = createTestCoreContext({ config: productionConfig });

    expect(() => {
      (ctx.config as { allowClockOverride: boolean }).allowClockOverride = true;
    }).toThrow(TypeError);
    expect(ctx.config.allowClockOverride).toBe(false);
  });

  it("rejects fractional basis points, which would round money wrong", () => {
    const base = createTestCoreContext();

    expect(() =>
      createCoreContext({ ...base, config: { ...base.config, commissionBps: 10.5 } }),
    ).toThrow(/commissionBps/);
  });

  it("rejects basis points outside 0..10000", () => {
    const base = createTestCoreContext();

    expect(() =>
      createCoreContext({ ...base, config: { ...base.config, hstBps: 10_001 } }),
    ).toThrow(/hstBps/);
  });

  it("explains itself when a test uses the database without supplying one", () => {
    const ctx = createTestCoreContext();

    expect(() => (ctx.db as unknown as Record<string, unknown>)["select"]).toThrow(
      /no database.*createTestCoreContext/s,
    );
  });
});
