import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SubscriptionCustomer } from "@polar-sh/sdk/models/components/subscriptioncustomer";
import type { WebhookSubscriptionCanceledPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncanceledpayload";
import type { WebhookSubscriptionUpdatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptionupdatedpayload";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  onSubscriptionCanceled,
  syncSubscription,
  toAccountStatusParams,
  toPlan,
  toSubscriptionStatus,
} from "../app/api/webhooks/polar/route";

const PRODUCTS = {
  POLAR_PRODUCT_FREE: "prod_free",
  POLAR_PRODUCT_PRO: "prod_pro",
  POLAR_PRODUCT_MAX: "prod_max",
  POLAR_PRODUCT_ULTRA: "prod_ultra",
};

describe("toSubscriptionStatus", () => {
  test.each([
    ["active", "active"],
    ["trialing", "active"],
    ["past_due", "past_due"],
    ["canceled", "canceled"],
  ] as const)("maps polar status %s to %s", (polarStatus, expected) => {
    expect(toSubscriptionStatus(polarStatus)).toBe(expected);
  });

  test.each(["incomplete", "incomplete_expired", "unpaid", "something_unknown"] as const)(
    "returns null for unmapped polar status %s",
    (polarStatus) => {
      expect(toSubscriptionStatus(polarStatus)).toBeNull();
    },
  );
});

// Returns a restore function rather than using afterEach, so a test that asserts on the
// captured output cannot leave console.error swapped out if it fails partway.
function captureError(sink: unknown[]): () => void {
  const original = console.error;
  console.error = (...args: unknown[]) => void sink.push(args.join(" "));
  return () => {
    console.error = original;
  };
}

function fakeCustomer(overrides: Partial<SubscriptionCustomer>): SubscriptionCustomer {
  return {
    id: "cus_1",
    externalId: "user_1",
    email: "a@example.com",
    ...overrides,
  } as SubscriptionCustomer;
}

describe("toPlan", () => {
  test.each([
    ["prod_free", "free"],
    ["prod_pro", "pro"],
    ["prod_max", "max"],
    ["prod_ultra", "ultra"],
  ] as const)("maps product id %s to plan %s", (productId, expected) => {
    expect(toPlan(productId, PRODUCTS)).toBe(expected);
  });

  // The webhook is the only writer of this column, so an id it cannot place has to write
  // null rather than guess — same treatment an unrecognized status already gets.
  test("returns null for a product id that is not configured", () => {
    expect(toPlan("prod_from_the_other_environment", PRODUCTS)).toBeNull();
  });

  /*
   * Deliberately not a throw. toPlan runs for every event type and nothing upstream catches
   * it, so throwing here 500s the whole webhook — taking subscription_status down with it,
   * which is unrelated to plans and works today. Writing null is safe now that the portal
   * resolves a null plan from Polar rather than believing it.
   */
  test("returns null, naming every missing variable, when nothing is configured", () => {
    const logged: unknown[] = [];
    const restore = captureError(logged);

    expect(toPlan("prod_free", {})).toBeNull();

    restore();
    expect(String(logged[0])).toContain(
      "POLAR_PRODUCT_FREE, POLAR_PRODUCT_PRO, POLAR_PRODUCT_MAX, POLAR_PRODUCT_ULTRA not set",
    );
  });

  test("names only the missing variables when the configuration is partial", () => {
    const logged: unknown[] = [];
    const restore = captureError(logged);

    expect(
      toPlan("prod_free", { POLAR_PRODUCT_FREE: "prod_free", POLAR_PRODUCT_PRO: "prod_pro" }),
    ).toBeNull();

    restore();
    expect(String(logged[0])).toContain("POLAR_PRODUCT_MAX, POLAR_PRODUCT_ULTRA not set");
  });

  // An operator error, distinct from the routine case above it, and logged louder.
  test("logs missing configuration at error level, not warn", () => {
    const errors: unknown[] = [];
    const restore = captureError(errors);

    toPlan("prod_free", {});

    restore();
    expect(errors).toHaveLength(1);
  });
});

describe("toAccountStatusParams", () => {
  test("builds upsert params when externalId is present", () => {
    const params = toAccountStatusParams(fakeCustomer({}), "active", "pro", 2000);

    expect(params).toEqual({
      workosUserId: "user_1",
      email: "a@example.com",
      polarCustomerId: "cus_1",
      status: "active",
      plan: "pro",
      amount: 2000,
    });
  });

  test("returns null when externalId is missing", () => {
    expect(
      toAccountStatusParams(fakeCustomer({ externalId: null }), "active", "pro", 2000),
    ).toBeNull();
  });

  test("returns null when externalId is undefined", () => {
    expect(
      toAccountStatusParams(fakeCustomer({ externalId: undefined }), "active", "pro", 2000),
    ).toBeNull();
  });
});

// Every payload here costs money, so upsertAccountStatus takes its unconditional path and the
// upsert is the only call the fake actually receives. These tests are about what gets written;
// the free-tier ordering guard and its conditional update are accountStatus.test.ts's subject.
//
// The `select` stanza below is left over from when upsertAccountStatus read the row before
// writing. It has been dead since that read was removed, and is left alone rather than tidied
// away here, being nobody's business in this change.
function fakeSupabase() {
  const calls: { row: Record<string, unknown> }[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
      upsert: (row: Record<string, unknown>) => {
        calls.push({ row });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function canceledPayload(productId: string): WebhookSubscriptionCanceledPayload {
  return {
    data: { status: "active", productId, amount: 2000, customer: fakeCustomer({}) },
  } as unknown as WebhookSubscriptionCanceledPayload;
}

function updatedPayload(
  status: string,
  cancelAtPeriodEnd: boolean,
): WebhookSubscriptionUpdatedPayload {
  return {
    data: {
      status,
      cancelAtPeriodEnd,
      productId: "prod_pro",
      amount: 2000,
      customer: fakeCustomer({}),
    },
  } as unknown as WebhookSubscriptionUpdatedPayload;
}

/*
 * `subscription.updated` fires for *every* change to a subscription, so scheduling a
 * cancellation delivers it alongside `subscription.canceled` as two independent POSTs with no
 * ordering guarantee between them. onSubscriptionCanceled hardcodes "canceled" precisely
 * because Polar keeps data.status at "active" through the notice period — but that only holds
 * the row if the `updated` event does not then overwrite it from the same stale field.
 *
 * What that costs when it happens is not cosmetic: the portal's fast path returns
 * `{plan:"pro", endsAt:null}` for an active row without consulting Polar, so the page renders
 * an ordinary paying account — no end date, no Resume — and offers switch buttons that
 * changePlan answers 409 to, because Polar still has cancelAtPeriodEnd set.
 */
describe("syncSubscription", () => {
  beforeAll(() => {
    for (const [name, value] of Object.entries(PRODUCTS)) process.env[name] = value;
  });
  afterAll(() => {
    for (const name of Object.keys(PRODUCTS)) delete process.env[name];
  });

  test("writes 'canceled' when an update carries a pending cancellation", async () => {
    const { client, calls } = fakeSupabase();

    await syncSubscription(updatedPayload("active", true), client);

    expect(calls[0]?.row.subscription_status).toBe("canceled");
  });

  test("writes 'active' for an ordinary update, so a renewal is not read as a cancellation", async () => {
    const { client, calls } = fakeSupabase();

    await syncSubscription(updatedPayload("active", false), client);

    expect(calls[0]?.row.subscription_status).toBe("active");
  });

  // The override is scoped to the status Polar leaves misleading. past_due is already
  // accurate and more specific, and overwriting it would hide a failing payment.
  test("leaves a status that is not 'active' alone", async () => {
    const { client, calls } = fakeSupabase();

    await syncSubscription(updatedPayload("past_due", true), client);

    expect(calls[0]?.row.subscription_status).toBe("past_due");
  });
});

describe("onSubscriptionCanceled", () => {
  // The route resolves the plan through process.env, so these have to be real for the
  // duration and gone afterwards — reassigning undefined would store the string.
  beforeAll(() => {
    for (const [name, value] of Object.entries(PRODUCTS)) process.env[name] = value;
  });
  afterAll(() => {
    for (const name of Object.keys(PRODUCTS)) delete process.env[name];
  });

  test("upserts status 'canceled' even though payload.data.status is still 'active'", async () => {
    const { client, calls } = fakeSupabase();

    await onSubscriptionCanceled(canceledPayload("prod_pro"), client);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.row.subscription_status).toBe("canceled");
    expect(calls[0]?.row.plan).toBe("pro");
  });

  // Configured, but on a product this environment does not name — a leftover from another
  // Polar organization, say. Null beats guessing, and beats leaving the column stale.
  test("writes a null plan for a product id that is configured away", async () => {
    const { client, calls } = fakeSupabase();

    await onSubscriptionCanceled(canceledPayload("prod_from_the_other_environment"), client);

    expect(calls[0]?.row.plan).toBeNull();
  });
});
