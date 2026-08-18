import { loadCatalog, type ModelCatalog, resetCatalogCache } from "@seri/model-catalog";

// apps/server stages no bundled manifest, so an empty fallback is the correct fail-closed
// posture: if models.dev is unreachable, no model can be proven zero-price, and every Free
// request is refused rather than forwarded on seri's own key.
const EMPTY_MANIFEST: ModelCatalog = { fetchedAt: "", entries: [] };

// loadCatalog already caches the in-flight promise itself, so this only needs to supply the two
// arguments a caller in this app would otherwise repeat everywhere. A successful fetch caches
// for the process's lifetime (per server instance: a cold start refetches once, not across
// instances) — the same as every other caller of loadCatalog.
//
// EMPTY_MANIFEST is the one exception: unlike apps/cli's own getModelCatalog (provider/catalog.ts),
// whose bundled FALLBACK_MANIFEST is a real, complete catalog worth keeping cached for the
// process, this fallback is deliberately unusable — caching it the normal way would fail every
// Free-tier request's isZeroPriceModel check for the rest of the instance's life over one
// transient models.dev failure. resetCatalogCache() clears it so the NEXT call retries instead;
// this is server-specific retry policy, not something loadCatalog itself should decide, since it
// has no way to know which callers' fallbacks are usable and which aren't.
export async function getModelCatalog(): Promise<ModelCatalog> {
  const catalog = await loadCatalog(EMPTY_MANIFEST, fetch);
  if (catalog === EMPTY_MANIFEST) resetCatalogCache();
  return catalog;
}
