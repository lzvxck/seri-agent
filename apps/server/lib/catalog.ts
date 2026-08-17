import { loadCatalog, type ModelCatalog } from "@seri/model-catalog";

// apps/server stages no bundled manifest, so an empty fallback is the correct fail-closed
// posture: if models.dev is unreachable, no model can be proven zero-price, and every Free
// request is refused rather than forwarded on seri's own key.
const EMPTY_MANIFEST: ModelCatalog = { fetchedAt: "", entries: [] };

// loadCatalog already caches the in-flight promise itself (process-lifetime), so this only
// needs to supply the two arguments a caller in this app would otherwise repeat everywhere.
// "Process-lifetime" is per server instance: a cold start (a new deployment, an autoscaled
// instance) refetches once and caches for its own lifetime, not across instances.
export function getModelCatalog(): Promise<ModelCatalog> {
  return loadCatalog(EMPTY_MANIFEST, fetch);
}
