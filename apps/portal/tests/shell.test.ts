import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { expect, mock, test } from "bun:test";

// A type-only import: erased before it runs, so it does not defeat the deferred import below.
import type { ShellProps } from "@/app/Shell";
import { BILLING, PLANS, USAGE } from "@/lib/routes";

/*
 * Sign out is a server action, so importing Shell pulls in @workos-inc/authkit-nextjs, which
 * pulls in `server-only` — a module whose whole job is to throw outside a Next server render.
 * The action itself is not what this test is about, so it is replaced and Shell imported after.
 */
mock.module("@/lib/actions", () => ({ endSession: async () => {} }));

const { Shell } = await import("@/app/Shell");

/*
 * Only the in-app destinations: the wordmark anchor is in-page and belongs to the chrome, not
 * to the control row.
 */
const inAppLinks = (current: ShellProps["current"]) =>
  renderToStaticMarkup(
    createElement(Shell, { email: "customer@example.com", current, children: null }),
  ).match(/href="\/[^"]*"/g);

/*
 * The bug this pinned shipped: /usage rendered a "View usage" button pointing at the page it
 * was already on, and with the wordmark being an in-page anchor, nothing on it reached the
 * plans again — the account page was unreachable from the one link that led away from it.
 *
 * Page switching now lives in SiteNav's own links, so all three pages carry the same ordered
 * array regardless of which one is current — /api/portal is gone from it entirely, reachable
 * only from the past-due banner on /billing.
 */
test("every signed-in page carries the same ordered nav, and no link to /api/portal", () => {
  expect(inAppLinks("account")).toEqual([
    `href="${PLANS}"`,
    `href="${BILLING}"`,
    `href="${USAGE}"`,
  ]);
  expect(inAppLinks("billing")).toEqual([
    `href="${PLANS}"`,
    `href="${BILLING}"`,
    `href="${USAGE}"`,
  ]);
  expect(inAppLinks("usage")).toEqual([`href="${PLANS}"`, `href="${BILLING}"`, `href="${USAGE}"`]);
});
