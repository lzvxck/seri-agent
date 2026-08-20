import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest, type NextFetchEvent } from "next/server";

import { assertClean, textNodes } from "@seri/copy-policy";
import { BILLING, PLANS, USAGE } from "../lib/routes";

const ORIGIN = "https://portal.seriora.ai";

/*
 * Every path that reaches authkit, recorded rather than inferred. "Not rewritten" alone would
 * also be satisfied by a proxy that returned next() and let the request through unauthenticated
 * — the opposite of what the /api/* case is there to prove — so the stub below records the
 * pathnames it was handed and the assertion names them.
 */
const authkitCalls: string[] = [];

/*
 * authkit-nextjs pulls in `server-only`, whose module body is a bare throw outside a Next
 * server render, and authkitProxy's real middleware would try to reach WorkOS and needs
 * WORKOS_* configuration no CI runner has. Replacing just that one export keeps the test about
 * the branch this file owns — which requests the holding takes and which it hands on — and
 * keeps it deterministic without env.
 *
 * The real authkit module is spread back in afterAll because mock.module registers process-wide
 * and does not unwind on its own: CI runs a bare `bun test` from the repo root, so every test
 * file shares one registry and file order differs per platform. That is the leak 6600f25b had
 * to fix for ../lib/paymentMethod, and it is why capturing the real module first is worth the
 * extra import.
 *
 * `server-only` is NOT restored, deliberately, and the reason is that it cannot be — measured
 * on bun 1.3.14, not assumed:
 *
 *   - Re-registering it with a throwing factory (the only way to reproduce a module whose body
 *     is a bare `throw`) fails this file instead of the next one: mock.module invokes the
 *     factory EAGERLY for an already-loaded module, so the throw lands inside afterAll.
 *   - `mock.restore()` does not un-register a module mock at all; after calling it, importing
 *     "server-only" still resolves to the stub.
 *
 * Leaving it stubbed is also harmless here in a way the authkit stub would not be. Its throw is
 * a Next BUNDLER guard — it exists to fail a build that pulls a server module into a client
 * bundle — and under `bun test` there is no client bundle for it to protect, so no assertion in
 * this repo can depend on it. tests/routes.test.ts has stubbed it unconditionally and
 * permanently for the same reason since long before this branch. Only this file and that one
 * touch it, and no portal source imports it directly; it arrives through authkit-nextjs.
 */
mock.module("server-only", () => ({}));

const realAuthkit = { ...(await import("@workos-inc/authkit-nextjs")) };

mock.module("@workos-inc/authkit-nextjs", () => ({
  ...realAuthkit,
  authkitProxy: () => (request: NextRequest) => {
    authkitCalls.push(request.nextUrl.pathname);
    return new Response(null, { status: 307 });
  },
}));

afterAll(() => {
  mock.module("@workos-inc/authkit-nextjs", () => realAuthkit);
});

// Deferred so the stub above is registered before proxy.ts calls authkitProxy at module scope.
const proxy = (await import("../proxy")).default;
const Holding = (await import("../app/holding/page")).default;

const HOLDING_MARKUP = renderToStaticMarkup(createElement(Holding));

/*
 * A rewrite is a next() carrying x-middleware-rewrite — both are 200s with no body, so the
 * header is the only thing that tells them apart.
 */
async function through(pathname: string) {
  authkitCalls.length = 0;
  const response = await proxy(new NextRequest(`${ORIGIN}${pathname}`), {} as NextFetchEvent);
  const header = response?.headers.get("x-middleware-rewrite") ?? null;
  return {
    rewrittenTo: header === null ? null : new URL(header).pathname,
    reachedAuthkit: authkitCalls.includes(pathname),
  };
}

/*
 * Set and DELETED per case rather than reassigned. `process.env.X = undefined` stores the
 * literal string "undefined", which is truthy to any naive read and leaks into every later test
 * in the same process — a bug this repo has already shipped twice
 * (.claude/rules/code-quality.md).
 */
beforeEach(() => {
  process.env.SERI_COMING_SOON = "1";
});

afterEach(() => {
  delete process.env.SERI_COMING_SOON;
});

describe("apps/portal holding", () => {
  // The signed-out surface this app has never had: today all three of these answer 307 to
  // WorkOS, and the holding has to be reachable without a session.
  test("serves the holding page on the three signed-in pages while the flag is set", async () => {
    for (const pathname of [PLANS, BILLING, USAGE]) {
      expect(await through(pathname)).toEqual({ rewrittenTo: "/holding", reachedAuthkit: false });
    }
  });

  /*
   * The security clause. A holding page is not a reason to open an endpoint that cancels
   * subscriptions or hands out invoice PDFs, so /api/* stays out of the allowlist and keeps
   * reaching authkit — which is asserted directly, not inferred from the absence of a rewrite.
   */
  test("hands the API routes to authkit untouched while the flag is set", async () => {
    for (const pathname of ["/api/cancel", "/api/invoice"]) {
      expect(await through(pathname)).toEqual({ rewrittenTo: null, reachedAuthkit: true });
    }
  });

  /*
   * /holding is not special-cased, and must not become so again. proxy.ts used to carry a
   * `pathname === HOLDING` next() ahead of the rewrite, which was a path exemption that made
   * GET /holding answer 200 unauthenticated; the rewrite never needed it, because
   * NextResponse.rewrite is internal and middleware does not re-run for the rewritten path.
   * Deleting it left the whole suite green, which is why this case exists.
   */
  test("leaves /holding itself to authkit rather than exempting it from auth", async () => {
    expect(await through("/holding")).toEqual({ rewrittenTo: null, reachedAuthkit: true });
  });

  test("rewrites nothing while the flag is unset", async () => {
    delete process.env.SERI_COMING_SOON;

    expect(await through(PLANS)).toEqual({ rewrittenTo: null, reachedAuthkit: true });
  });

  /*
   * D3, pinned in the app it would break. Reveal renders data-reveal="pending" on the server,
   * which globals.css defines as opacity: 0, and only RevealNoScript inside <head> undoes that
   * — and this app's layout.tsx has no <head>. A Reveal-wrapped holding page is therefore blank
   * here for every client without JS, which on a page whose audience is crawlers, link previews
   * and first-time visitors is the worst available failure.
   */
  test("renders without a Reveal, which this app has no <head> to undo", () => {
    expect(HOLDING_MARKUP).not.toContain("data-reveal");
  });

  test("says nothing the copy policy forbids", () => {
    assertClean(textNodes(HOLDING_MARKUP), { allowComingSoon: true });
  });
});
