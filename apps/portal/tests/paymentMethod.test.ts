import { describe, expect, test } from "bun:test";
import { getPaymentMethod } from "../lib/paymentMethod";

// A fake `fetch`, injected the same way orders.test.ts injects `wait` — so this exercises the
// parsing logic with no outbound request at all, rather than reaching for a global mock.
function fakeFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  const calls: string[] = [];
  const fetchImpl = ((url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok: response.ok,
      status: response.status ?? 200,
      json: response.json ?? (async () => ({ items: [] })),
    } as Response);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("getPaymentMethod", () => {
  test("asks the injected fetch, never the global one", async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: true });

    await getPaymentMethod("user_1", fetchImpl);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/v1/customers/external/user_1/payment-methods");
  });

  test("picks the is_default entry among several and maps method_metadata", async () => {
    const { fetchImpl } = fakeFetch({
      ok: true,
      json: async () => ({
        items: [
          {
            is_default: false,
            method_metadata: { brand: "mastercard", last4: "0000", exp_month: 1, exp_year: 2030 },
          },
          {
            is_default: true,
            method_metadata: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
          },
        ],
      }),
    });

    expect(await getPaymentMethod("user_1", fetchImpl)).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2028,
    });
  });

  /*
   * The shape seen against sandbox on 2026-08-06: one customer, one card attached during
   * checkout, `is_default: false`. Reading the flag alone showed "No payment method on file."
   * to an active subscriber whose visa ···· 4242 was on file. One observation, and Polar
   * documents no rule either way — see lib/paymentMethod.ts for what that does and does not
   * license.
   */
  test("returns the only card when Polar flags none as default", async () => {
    const { fetchImpl } = fakeFetch({
      ok: true,
      json: async () => ({
        items: [
          {
            is_default: false,
            method_metadata: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
          },
        ],
      }),
    });

    expect(await getPaymentMethod("user_1", fetchImpl)).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2028,
    });
  });

  // The boundary of that fallback: with no flag and more than one candidate there is nothing to
  // name, and answering with the first would be an invented choice rather than a read.
  test("returns null when several cards exist and none is default", async () => {
    const { fetchImpl } = fakeFetch({
      ok: true,
      json: async () => ({
        items: [
          {
            is_default: false,
            method_metadata: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
          },
          {
            is_default: false,
            method_metadata: { brand: "mastercard", last4: "0000", exp_month: 1, exp_year: 2030 },
          },
        ],
      }),
    });

    expect(await getPaymentMethod("user_1", fetchImpl)).toBeNull();
  });

  test("returns null when there are no payment methods at all", async () => {
    const { fetchImpl } = fakeFetch({ ok: true, json: async () => ({ items: [] }) });

    expect(await getPaymentMethod("user_1", fetchImpl)).toBeNull();
  });

  test("throws with the status on a non-OK response, rather than parsing a body", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 401 });

    await expect(getPaymentMethod("user_1", fetchImpl)).rejects.toThrow(
      "Polar payment-methods request failed with status 401",
    );
  });
});
