import Image from "next/image";
import Link from "next/link";

// WitUS ecosystem footer for inbox.witus.online. Adapted from fly-witus
// (claude/fly-witus/src/components/site-footer.tsx) with three changes:
//   1. Slate palette matching this app's existing chrome (light + dark
//      mode) instead of fly-witus's light-only gray/sky.
//   2. Logo + brand name swapped to WitUS Inbox using a chosen variant
//      from public/brand/ — see the BRAND_VARIANT constant.
//   3. Inbox-section links pruned (no public /pricing or /roadmap
//      surfaces here; the only public routes are auth pages).
//
// The Rise Wellness callout below is the canonical mental-health partner
// surface that appears across the WitUS ecosystem. Disclaimer text is
// mandatory and stays verbatim apart from product-name swaps.
//
// Sibling product list is duplicated here rather than imported from a
// shared package because each WitUS app is a separate repo. When the
// ecosystem changes, mirror the update across:
//   - claude/witus-inbox/components/SiteFooter.tsx (this file)
//   - claude/fly-witus/src/components/site-footer.tsx
//   - gemini/witus/components/Footer.tsx
//   - gemini/witus/lib/products.ts (source of truth, when an @witus/
//     ecosystem npm package eventually centralizes this).

// Which brand variant to render in the footer logo + the page favicon.
// Options under public/brand/:
//   "01-orbit"      — orbit-only logomark
//   "02-duality"    — two-tone duality
//   "03-type-dot"   — typography + dot
//   "04-orbit-type" — orbit + type (witus.online's choice)
// Change this to swap. Layout's icons metadata reads the same constant.
export const BRAND_VARIANT = "04-orbit-type" as const;

interface SiblingProduct {
  name: string;
  href: string;
}

const SIBLING_PRODUCTS: SiblingProduct[] = [
  { name: "WitUS.online", href: "https://witus.online" },
  { name: "CentenarianOS", href: "https://centenarianos.com" },
  { name: "Work.WitUS", href: "https://work.witus.online" },
  { name: "Tour Manager OS", href: "https://tour.witus.online" },
  { name: "Wanderlearn", href: "https://wanderlearn.witus.online" },
  { name: "FlashLearnAI", href: "https://flashlearnai.witus.online" },
  { name: "Fly.WitUS", href: "https://fly.witus.online" },
  { name: "Learn.WitUS", href: "https://centenarianos.com/academy" },
  { name: "AwesomeWebStore", href: "https://awesomewebstore.com" },
];

const linkClasses =
  "inline-flex items-center min-h-[28px] text-slate-600 hover:text-sky-700 hover:underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 rounded motion-reduce:transition-none dark:text-slate-400 dark:hover:text-sky-400";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-white border-t border-slate-200 mt-12 dark:bg-slate-950 dark:border-slate-800">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex flex-col items-center text-center mb-8">
          <Image
            src={`/brand/${BRAND_VARIANT}/logomark.svg`}
            alt="WitUS Inbox"
            width={56}
            height={56}
            className="h-12 w-auto mb-2"
          />
          <p className="font-extrabold text-slate-900 dark:text-slate-50">WITUS INBOX</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cross-product submission triage
          </p>
        </div>

        <RiseWellnessCallout />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
          <div>
            <p className="text-slate-900 font-semibold mb-2 dark:text-slate-50">Ecosystem</p>
            <ul className="space-y-1">
              {SIBLING_PRODUCTS.map((p) => (
                <li key={p.href}>
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClasses}
                  >
                    {p.name}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-slate-900 font-semibold mb-2 dark:text-slate-50">Inbox</p>
            <ul className="space-y-1">
              <li>
                <Link href="/auth/sign-in" className={linkClasses}>
                  Sign in
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/dapperAuteur/witus-inbox"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  Source on GitHub
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/dapperAuteur/witus-inbox/blob/main/docs/webhook-contract.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  Webhook contract
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/dapperAuteur/witus-inbox/blob/main/docs/roadmap.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  Roadmap
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-slate-900 font-semibold mb-2 dark:text-slate-50">
              Partners &amp; Legal
            </p>
            <ul className="space-y-1">
              <li>
                <a
                  href="https://www.centenarianos.com/safety#rise-wellness"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  Rise Wellness
                  <span className="sr-only"> (wellness partner — opens in new tab)</span>
                </a>
                <p className="text-xs text-slate-400 leading-tight dark:text-slate-500">
                  Wellness partner
                </p>
              </li>
              <li className="pt-2">
                <a
                  href="https://witus.online/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  Terms
                </a>
              </li>
              <li>
                <a
                  href="https://witus.online/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  Privacy
                </a>
              </li>
              <li>
                <a href="mailto:a@awews.com" className={linkClasses}>
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 text-xs text-slate-500 text-center dark:border-slate-800 dark:text-slate-400">
          <p>
            &copy; {year} B4C LLC &mdash; A{" "}
            <a
              href="https://awesomewebstore.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 hover:text-sky-700 hover:underline dark:text-slate-300 dark:hover:text-sky-400"
            >
              AwesomeWebStore.com
              <span className="sr-only"> (opens in new tab)</span>
            </a>{" "}
            brand
          </p>
        </div>
      </div>
    </footer>
  );
}

/**
 * Mental health support callout. Mirrors the Rise Wellness section at
 * https://www.centenarianos.com/safety#rise-wellness so the same
 * partner surface appears across the WitUS ecosystem. Independent
 * provider; the non-affiliation disclaimer is mandatory and stays
 * verbatim apart from the product-name swap.
 *
 * Placed above the three-column grid (rather than buried inside
 * Partners & Legal) because mental-health resources warrant
 * prominence per the pattern centenarianos uses on its dedicated
 * /safety page.
 */
function RiseWellnessCallout() {
  return (
    <section
      aria-labelledby="rise-wellness-heading"
      className="mb-8 rounded-lg border border-sky-100 bg-sky-50/60 p-5 text-sm dark:border-sky-900/40 dark:bg-sky-950/30"
    >
      <header className="mb-3">
        <p className="text-[11px] uppercase tracking-wide text-sky-700 font-semibold dark:text-sky-300">
          Mental health support
        </p>
        <h2
          id="rise-wellness-heading"
          className="text-base font-semibold text-slate-900 dark:text-slate-50"
        >
          Rise Wellness of Indiana
        </h2>
        <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
          Independent mental health provider &middot; Not affiliated with WitUS Inbox
        </p>
      </header>

      <p className="text-slate-700 leading-relaxed dark:text-slate-300">
        Rise Wellness of Indiana provides compassionate, personalized,
        holistic mental health care &mdash; evidence-based medicine,
        trauma-informed care, and a whole-person approach to help you heal,
        grow, and thrive in mind, body, and spirit.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold dark:text-slate-400">
            Services
          </p>
          <ul className="text-xs text-slate-700 space-y-0.5 dark:text-slate-300">
            <li>ADHD testing &amp; management (in-person and from home)</li>
            <li>Anxiety &amp; depression</li>
            <li>Maternal mental health</li>
            <li>Medication management</li>
            <li>GeneSight&reg; genetic testing</li>
            <li>Behavioral therapy &amp; coaching</li>
            <li>Routine lab testing</li>
          </ul>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold dark:text-slate-400">
            Visit or call
          </p>
          <address className="not-italic text-xs text-slate-700 leading-relaxed dark:text-slate-300">
            320 North Meridian Street
            <br />
            Indianapolis, IN 46204
            <br />
            Mon&ndash;Sat by appointment &middot; Sun closed
          </address>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs">
            <a
              href="tel:+13179650299"
              className="inline-flex items-center min-h-[28px] font-medium text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 rounded dark:text-sky-400"
            >
              317-965-0299
            </a>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
              &middot;
            </span>
            <a
              href="https://risewellnessofindiana.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center min-h-[28px] font-medium text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 rounded dark:text-sky-400"
            >
              risewellnessofindiana.com
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
              &middot;
            </span>
            <a
              href="https://www.centenarianos.com/safety#rise-wellness"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center min-h-[28px] font-medium text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 rounded dark:text-sky-400"
            >
              Full safety page
              <span className="sr-only"> on centenarianos.com (opens in new tab)</span>
            </a>
          </div>
        </div>
      </div>

      <blockquote className="mt-4 border-l-2 border-sky-300 pl-3 text-xs italic text-slate-600 dark:border-sky-700 dark:text-slate-400">
        &ldquo;At Rise Wellness, we believe everyone has the capacity to rise
        above challenges and live a fulfilling, healthy life. Our care is
        guided by the belief that healing is personal, holistic, and rooted
        in compassion.&rdquo;
        <span className="block not-italic mt-1 text-slate-500 dark:text-slate-500">
          &mdash; Rise Wellness of Indiana
        </span>
      </blockquote>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        Rise Wellness of Indiana is an independent organization. They are not
        affiliated with, employed by, or endorsed by WitUS Inbox,
        CentenarianOS, B4C LLC, AwesomeWebStore.com, or Anthony McDonald. We
        are grateful for their collaboration on mental health safety
        resources for our community.
      </p>
    </section>
  );
}
