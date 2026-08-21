import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetCatalogCache } from "@seri/model-catalog";
import { getModelCatalog } from "../lib/catalog";

describe("getModelCatalog", () => {
  const originalDisableFlag = process.env.SERI_DISABLE_MODELS_FETCH;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetCatalogCache();
    delete process.env.SERI_DISABLE_MODELS_FETCH;
  });

  afterEach(() => {
    if (originalDisableFlag === undefined) delete process.env.SERI_DISABLE_MODELS_FETCH;
    else process.env.SERI_DISABLE_MODELS_FETCH = originalDisableFlag;
    globalThis.fetch = originalFetch;
  });

  // The fix: EMPTY_MANIFEST is deliberately unusable (every Free-tier isZeroPriceEntry check
  // fails against it), so — unlike a caller with a real, complete fallback — this must NOT be
  // cached for the process lifetime. Without resetCatalogCache() here, one transient
  // models.dev failure would 402 model_not_in_free_tier for every Free request for the rest of
  // this instance's life.
  test("a failed fetch's EMPTY_MANIFEST fallback is not cached — the next call retries", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const first = await getModelCatalog();
    const second = await getModelCatalog();

    expect(first.entries).toEqual([]);
    expect(second.entries).toEqual([]);
    expect(calls).toBe(2);
  });

  test("a failed fetch followed by a working one succeeds on the retry", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;

    const first = await getModelCatalog();
    const second = await getModelCatalog();

    expect(first.entries).toEqual([]);
    expect(second.fetchedAt).not.toBe("");
  });

  // The positive control for the fix above: a genuine successful fetch still caches normally —
  // only the unusable fallback bypasses the cache.
  test("a successful fetch is cached for the process — a second call does not re-fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;

    await getModelCatalog();
    await getModelCatalog();

    expect(calls).toBe(1);
  });
});
