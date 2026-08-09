import { Button } from "./button";
import { SerioraMark } from "./seriora-mark";

/*
 * The wordmark links to `#top`, so the page that renders this must carry that id.
 * `links` are the site-specific entries.
 *
 * `current` is optional and additive: apps/web and apps/lab pass nothing, so every link
 * renders `ghost` exactly as before. A caller that does pass it gets the matching link
 * rendered inverted, e.g. the portal marking which of its own pages is showing.
 */
export function SiteNav({
  wordmark,
  links,
  current,
}: {
  wordmark: string;
  links: { label: string; href: string }[];
  current?: string;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-hairline bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1080px] items-center justify-between px-11 py-8 md:px-16">
        <a
          href="#top"
          className="inline-flex items-center gap-3 font-mono text-mono font-bold tracking-[-0.4px]"
        >
          <SerioraMark />
          {wordmark}
        </a>
        <nav className="flex items-center gap-4">
          {links.map((link) => (
            <Button
              key={link.href}
              asChild
              variant={link.href === current ? "default" : "ghost"}
              size="sm"
            >
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </nav>
      </div>
    </header>
  );
}
