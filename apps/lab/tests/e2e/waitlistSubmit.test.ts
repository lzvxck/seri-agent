import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { WAITLIST_COPY } from "../../lib/waitlistCopy";
import { HONEYPOT_FIELD } from "../../lib/waitlist/shared";

// `proc.kill()` alone reports success and leaves the `next start` process it launched still
// running — the exact Windows leak apps/cli/src/tools/spawnCollect.ts's killTree exists to
// close (measured there, and reproduced here the same way: two orphaned node processes still
// listening after a green test run). Carried forward rather than re-derived.
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/*
 * Gated on SERI_E2E because it needs a production build: `bun run --cwd apps/web build` with
 * SERI_COMING_SOON=1 is the prerequisite the plan names. It touches no live Supabase — every
 * SUPABASE_URL below points at a Bun.serve stub on an ephemeral port.
 *
 * What this closes that proxy.test.ts's POST case (tests/proxy.test.ts) cannot: that test only
 * proves middleware rewrites a POST to /holding. It says nothing about whether Next resolves
 * the Server Action reference across that rewrite — this file replays the real hidden
 * $ACTION_* fields React emits against a real `next start`, which is the only way to answer
 * that question.
 */
const WEB_DIR = join(import.meta.dir, "../..");
const NEXT_DIR = join(WEB_DIR, ".next");

/*
 * -p 0 asks the OS for an ephemeral port; `next start` prints the port it actually bound
 * ("- Local: http://localhost:<port>") rather than exposing it programmatically, so it is read
 * off stdout — measured against the real CLI output on this Next version, not assumed.
 */
async function startNext(
  env: Record<string, string>,
): Promise<{ port: number; proc: Bun.Subprocess }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "x", "next", "start", "-p", "0"],
    cwd: WEB_DIR,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const match = buffered.match(/Local:\s+https?:\/\/localhost:(\d+)/);
    if (match) return { port: Number(match[1]), proc };
  }
  throw new Error(`next start did not report a port within 30s. Output so far:\n${buffered}`);
}

async function pollUntilReady(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`http://127.0.0.1:${port}/ did not answer within 30s`);
}

/*
 * React's field names in the real HTML ($ACTION_REF_1, $ACTION_1:0, $ACTION_1:2, $ACTION_1:1,
 * $ACTION_KEY — measured against the real build, not the "$ACTION_ID_*" name the plan guessed)
 * are read generically by prefix rather than hardcoded, so a Next upgrade that renames them
 * does not silently make this test replay nothing.
 */
function extractActionForm(html: string): { action: string; fields: [string, string][] } {
  const formStart = html.indexOf("<form");
  const formEnd = html.indexOf("</form>", formStart) + "</form>".length;
  if (formStart === -1 || formEnd === -1) throw new Error("No <form> found in the response HTML");
  const form = html.slice(formStart, formEnd);

  const actionMatch = form.match(/\baction="([^"]*)"/);
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

  const fields: [string, string][] = [];
  const inputRe = /<input\s+type="hidden"\s+name="(\$ACTION[^"]*)"(?:\s+value="([^"]*)")?\s*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = inputRe.exec(form))) fields.push([match[1], match[2] ? decode(match[2]) : ""]);

  return { action: actionMatch ? actionMatch[1] : "", fields };
}

// The real form's encType is multipart/form-data (React's own choice for a Server Action, and
// confirmed in the served HTML) and that is load-bearing: a x-www-form-urlencoded replay of the
// identical fields is not recognized as an action submission at all, so no insert is recorded
// and the test fails outright. Measured, not assumed.
async function submitWaitlist(pageUrl: string, email: string, honeypot: string): Promise<Response> {
  const html = await (await fetch(pageUrl)).text();
  const { action, fields } = extractActionForm(html);
  const target = new URL(action || "/", pageUrl);

  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  form.append("email", email);
  form.append(HONEYPOT_FIELD, honeypot);

  return fetch(target, { method: "POST", body: form });
}

describe.skipIf(!process.env.SERI_E2E)("waitlist submit e2e", () => {
  let stub: ReturnType<typeof Bun.serve>;
  let stubStatus = 201;
  const stubRequests: { method: string; path: string; body: string }[] = [];

  let holding: { port: number; proc: Bun.Subprocess };
  let marketing: { port: number; proc: Bun.Subprocess };

  beforeAll(async () => {
    if (!existsSync(NEXT_DIR)) {
      throw new Error(
        "apps/web/.next is missing. Run `bun run --cwd apps/web build` with SERI_COMING_SOON=1 first.",
      );
    }

    stub = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.text();
        stubRequests.push({ method: request.method, path: url.pathname, body });
        return new Response(stubStatus === 201 ? "[]" : "stub error", { status: stubStatus });
      },
    });

    const supabaseEnv = {
      SUPABASE_URL: `http://127.0.0.1:${stub.port}`,
      SUPABASE_SERVICE_ROLE_KEY: "stub",
    };

    holding = await startNext({ SERI_COMING_SOON: "1", ...supabaseEnv });
    await pollUntilReady(holding.port);

    // Negative control A's own server: SERI_COMING_SOON unset, same build artefact.
    marketing = await startNext(supabaseEnv);
    await pollUntilReady(marketing.port);
  }, 60_000);

  afterAll(() => {
    if (holding) killTree(holding.proc.pid);
    if (marketing) killTree(marketing.proc.pid);
    stub?.stop(true);
  });

  test("positive: a no-JS form POST to / survives the holding rewrite and inserts the normalized address", async () => {
    stubStatus = 201;
    stubRequests.length = 0;

    const pageUrl = `http://127.0.0.1:${holding.port}/`;
    const pageHtml = await (await fetch(pageUrl)).text();
    expect(pageHtml).toContain("holding-waitlist");
    expect(pageHtml).toContain("Coming soon");

    const response = await submitWaitlist(pageUrl, "E2E@Example.com", "");
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(500);

    const insert = stubRequests.find((request) => request.path === "/rest/v1/waitlist_signups");
    expect(insert).toBeDefined();
    expect(insert?.body).toContain("e2e@example.com");
  });

  test("negative control A: the marketing home page (flag unset) carries no waitlist form", async () => {
    const html = await (await fetch(`http://127.0.0.1:${marketing.port}/`)).text();
    expect(html).not.toContain("holding-waitlist");
    expect(html).not.toContain(WAITLIST_COPY.submit);
  });

  test("negative control B: a failed insert never returns the success copy", async () => {
    stubStatus = 500;
    stubRequests.length = 0;

    const pageUrl = `http://127.0.0.1:${holding.port}/`;
    const response = await submitWaitlist(pageUrl, "e2e-control@example.com", "");
    const body = await response.text();

    // Absence of the success copy alone doesn't discriminate — an empty body or a redirect
    // would pass that assertion too. Asserting the failed copy is present is what proves the
    // response actually reflects the insert failure rather than something else going wrong.
    expect(body).not.toContain(WAITLIST_COPY.ok);
    expect(body).toContain(WAITLIST_COPY.failed);

    stubStatus = 201;
  });
});
