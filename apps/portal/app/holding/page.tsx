import { ComingSoon } from "@seri/ui";

/*
 * The page proxy.ts rewrites `/`, /billing and /usage to while SERI_COMING_SOON is set, ahead
 * of authkitProxy, so it is the one surface of this app a visitor without a WorkOS session can
 * reach. It reads no environment variable: the flag is decided in middleware and nowhere else,
 * which is what keeps the three real pages and their auth boundary untouched.
 *
 * Unlike lab's and web's copies of this page, /holding is NOT reachable directly here in either
 * flag state — measured on a running build: 307 to WorkOS with the flag set and with it unset,
 * because this app's matcher is a catch-all and proxy.ts exempts nothing from auth. Only the
 * rewritten `/`, /billing and /usage render it.
 */
export default function Holding() {
  return <ComingSoon wordmark="Seriora Portal" line="Plans and billing for seri." />;
}
