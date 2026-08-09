import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, test } from "bun:test";

import { assertClean, textNodes } from "@seri/copy-policy";
import Holding from "../app/holding/page";
import { metadata } from "../app/layout";
import Privacy, { metadata as privacyMetadata } from "../app/privacy/page";
import Home from "../app/page";
import { ProductList, type Product } from "../app/ProductList";
import { WAITLIST_COPY } from "../lib/waitlistCopy";

const FIXTURES: Product[] = [
  { name: "one", href: "https://example.com/one", body: "The first product." },
  { name: "two", href: "https://example.com/two", body: "The second product." },
];

// Why the page is rendered rather than read as source, and what rendering does not cover, are
// both on assertClean.
const MARKUP = renderToStaticMarkup(createElement(Home));
const COPY = textNodes(MARKUP);

/*
 * The <title> and <meta description> make the same kind of claim and travel furthest from the
 * site. The layout is not rendered: it is a shell around {children} whose output would be the
 * page again, so the metadata export is read directly. The structural assertions below stay on
 * the page alone — they are about how this page is built.
 */
const META = `${metadata.title} ${metadata.description}`;

describe("seriora.ai copy", () => {
  test("says nothing the copy policy forbids", () => {
    assertClean(`${COPY} ${META}`);
  });

  /*
   * The holding page proxy.ts rewrites `/` to while SERI_COMING_SOON is set. It is held to the
   * same policy as the page it stands in for, including the layout metadata a visitor still
   * gets served underneath it, and it is asserted here rather than in packages/ui because this
   * is where this site's real props for <ComingSoon> are written.
   *
   * WAITLIST_COPY is folded in the same way InstallTabs.PLATFORMS is folded in on apps/web:
   * `ok`, `invalid` and `failed` only ever appear as WaitlistForm's `state.message`, set after a
   * Server Action response, so renderToStaticMarkup's initial render never contains them.
   */
  test("the holding page says nothing the copy policy forbids", () => {
    const waitlistCopy = Object.values(WAITLIST_COPY).join(" ");
    assertClean(
      `${textNodes(renderToStaticMarkup(createElement(Holding)))} ${META} ${waitlistCopy}`,
      {
        allowComingSoon: true,
      },
    );
  });

  // The privacy page does not say "coming soon" and must not be granted that exemption.
  test("the privacy page says nothing the copy policy forbids", () => {
    assertClean(
      `${textNodes(renderToStaticMarkup(createElement(Privacy)))} ${privacyMetadata.title}`,
    );
  });

  test("leads with the research thesis", () => {
    expect(COPY).toContain("An independent research lab");
    expect(COPY).toContain("We study agents that improve themselves.");
  });

  /*
   * The hero, the problem, the open problems and the principles have to read the same way if
   * the lab ships a second product, so within <main> the only place a product name may appear
   * is the products list. Both cuts are asserted to have removed something — a selector that
   * quietly stops matching would leave this test passing while checking nothing.
   *
   * The nav is outside <main> deliberately, not overlooked: SiteNav's "Agent" entry is site
   * chrome that names the product on purpose.
   *
   * "Seriora" is the lab itself, not a product, and does not match \bseri\b.
   */
  test("names no product outside the products list", () => {
    const main = MARKUP.match(/<main[\s\S]*<\/main>/);
    expect(main).not.toBeNull();

    const products = main![0].match(/<ul id="products"[\s\S]*?<\/ul>/);
    expect(products).not.toBeNull();

    expect(textNodes(main![0].replace(products![0], ""))).not.toMatch(/\bseri\b/i);
  });

  /*
   * The lab ships one product and its neutrality criterion is that a second needs no rewrite,
   * so the list is rendered with two fixture entries and the claim asserted directly. This
   * used to assert `toContain("md:grid-cols-2")` on the rendered <ul>, which went red on any
   * restyle and did not test its own name: a class says nothing about whether a second entry
   * arrives as a sibling of the first or needs the section rebuilt around it.
   */
  test("puts the products in a list that takes a second entry unchanged", () => {
    const render = (products: Product[]) =>
      renderToStaticMarkup(createElement(ProductList, { products }));

    const one = render([FIXTURES[0]!]);
    const two = render(FIXTURES);

    // The container is byte-identical either way: nothing about the list is per-count.
    expect(two.slice(0, two.indexOf(">") + 1)).toBe(one.slice(0, one.indexOf(">") + 1));
    // And the second entry is a sibling of the first, carrying its own copy.
    expect(two.match(/<li\b/g)).toHaveLength(2);
    expect(textNodes(two)).toContain("The second product.");
  });
});
