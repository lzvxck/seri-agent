import { describe, expect, test } from "bun:test";
import { ACCOUNT_UPDATED, isFreshLoad, needsMarkerlessReload } from "../lib/routes";

/*
 * The marker is a protocol between files that never call each other: billing.ts and the
 * customer-portal route produce it, page.tsx reads it. Spelled as a literal at each end, a
 * rename compiles perfectly and silently stops working, so the round trip is asserted here
 * rather than assumed.
 */
describe("the freshness marker", () => {
  test("is recognized by the reader exactly as the producers write it", () => {
    const query = Object.fromEntries(
      new URL(ACCOUNT_UPDATED, "https://portal.seriora.ai").searchParams,
    );

    expect(isFreshLoad(query)).toBe(true);
  });

  test("is absent from an ordinary load", () => {
    expect(isFreshLoad({})).toBe(false);
  });

  // Presence is the whole signal, so a repeated parameter — which Next hands over as an array
  // — is still a fresh load rather than a shape that reads as missing.
  test("survives being repeated", () => {
    expect(isFreshLoad({ updated: ["1", "2"] })).toBe(true);
  });
});

/*
 * Nothing strips the marker, so a fresh load that resolves to no plan would otherwise be
 * permanent: the customer sits on "a plan we no longer offer" with nothing selectable, no
 * Resume and no Free, and the repair that would give them Free back lives on the ordinary
 * path, which `fresh` skips. Reachable by abandoning a checkout, whose free subscription was
 * already revoked to make room for it.
 */
describe("needsMarkerlessReload", () => {
  test("hands a fresh load with no plan back to the ordinary path", () => {
    expect(needsMarkerlessReload(true, null)).toBe(true);
  });

  test("leaves a fresh load that resolved to a plan alone", () => {
    expect(needsMarkerlessReload(true, "free")).toBe(false);
  });

  /*
   * The one that must not be true, or the retired-product page — a legitimate state with no
   * plan — would redirect to itself forever.
   */
  test("never fires on an ordinary load, whatever it resolved to", () => {
    expect(needsMarkerlessReload(false, null)).toBe(false);
  });
});
