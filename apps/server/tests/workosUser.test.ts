import { describe, expect, test } from "bun:test";
import { fetchUserEmail } from "../lib/workosUser";

function fakeFetch(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

describe("fetchUserEmail", () => {
  test("extracts the email from a real WorkOS user record", async () => {
    const response = new Response(
      JSON.stringify({ id: "user_01H", email: "real@example.com", email_verified: true }),
      { status: 200 },
    );

    expect(await fetchUserEmail("user_01H", fakeFetch(response))).toBe("real@example.com");
  });

  test("a 404 (no such user) returns undefined rather than throwing", async () => {
    const response = new Response(JSON.stringify({ message: "not found" }), { status: 404 });

    expect(await fetchUserEmail("user_missing", fakeFetch(response))).toBeUndefined();
  });

  // "Never throws" has to cover a rejected fetch (network exception), not just a non-OK
  // response — this is best-effort enrichment, not a hard dependency of ensureCustomer.
  test("a fetch that throws returns undefined rather than rejecting", async () => {
    const throwingFetch = (async () => {
      throw new Error("network exception");
    }) as unknown as typeof fetch;

    await expect(fetchUserEmail("user_01H", throwingFetch)).resolves.toBeUndefined();
  });
});
