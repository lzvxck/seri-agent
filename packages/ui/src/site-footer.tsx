/*
 * `builtBy` credits the lab that builds the site's subject. It is optional because the lab's
 * own site would otherwise credit itself.
 */
export function SiteFooter({
  wordmark,
  builtBy,
}: {
  wordmark: string;
  builtBy?: { label: string; href: string };
}) {
  return (
    <footer className="border-t border-ink-hairline">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-11 py-16 md:flex-row md:items-center md:justify-between md:px-16">
        <span className="font-mono text-mono font-bold tracking-[-0.4px]">
          {wordmark}
          {builtBy ? (
            <span className="font-normal">
              {" by "}
              <a
                href={builtBy.href}
                target="_blank"
                rel="noreferrer"
                className="text-ink-subtle hover:text-ink"
              >
                {builtBy.label}
              </a>
            </span>
          ) : null}
        </span>
      </div>
    </footer>
  );
}
