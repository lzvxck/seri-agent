import { loadCatalog, type ModelCatalog } from "@seri/model-catalog";

// apps/server stages no bundled manifest, so an empty fallback is the correct fail-closed
// posture: if models.dev is unreachable, no model can be proven zero-price, and every Free
// request is refused rather than forwarded on seri's own key.
const EMPTY_MANIFEST: ModelCatalog = { fetchedAt: "", entries: [] };

// loadCatalog already caches the in-flight promise itself, so this only needs to supply the two
// arguments a caller in this app would otherwise repeat everywhere. A successful fetch caches
// for the process's lifetime (per server instance: a cold start refetches once, not across
// instances); a fetch that falls back to EMPTY_MANIFEST is NOT cached that long — loadCatalog
// retries on the next call rather than returning 402 model_not_in_free_tier to every Free
// request for the rest of the instance's life over one transient models.dev failure.
export function getModelCatalog(): Promise<ModelCatalog> {
  return loadCatalog(EMPTY_MANIFEST, fetch);
}
