// Best-effort enrichment for entitlement.ts's ensureCustomer: called only when identity.email
// is undefined and a Polar customer is about to be created for the first time, since a WorkOS
// access token carries no email claim (lib/workosToken.ts's own verifyAccessToken). A raw
// fetch, matching apps/cli/src/auth/deviceFlow.ts's/refresh.ts's style rather than introducing
// @workos-inc/node client-side. Endpoint and response shape verified against that SDK's own
// getUser implementation: GET /user_management/users/{userId} against api.workos.com, bearer
// auth, response body's `email` field. Never throws: a missing user, a network failure, or a
// malformed response all just mean no email was found, the same as identity.email already being
// undefined — this is enrichment, not a hard dependency.
export async function fetchUserEmail(
  userId: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchFn(
      `https://api.workos.com/user_management/users/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${process.env.WORKOS_API_KEY}` } },
    );
    if (!response.ok) return undefined;
    const body = await response.json();
    return typeof body.email === "string" ? body.email : undefined;
  } catch {
    return undefined;
  }
}
