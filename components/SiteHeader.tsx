import Image from "next/image";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { SignOutButton } from "@/components/SignOutButton";
import { BRAND_VARIANT } from "@/components/SiteFooter";

// The app header, mounted in the root layout so every page has it: the sign-in page, the inbox, the
// 404 and the route error boundary (witus docs/shared-ui-ux-dx.md, "Sign-in control" and "Error
// pages keep the app shell"). Signed out it shows a link whose accessible name is exactly "Sign in";
// signed in it shows the Inbox link and the local "Sign out" (never renamed). Until this file the app
// had no header at all, only a footer (BAM, 2026-11-09: "out/in-box needs header").
//
// Server component: the session is read here so no client component has to carry a provider. The
// auth module is imported lazily inside the try: building its options opens the database client and
// validates env at module load, and this header is in the root layout, so a missing variable (or an
// unreachable database) must render the signed-out header, not take the whole shell down with the
// page or fail the build of the static error pages.
const linkClasses =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-50";

export async function SiteHeader() {
  let signedIn = false;
  try {
    const { authOptions } = await import("@/lib/auth");
    const session = await getServerSession(authOptions);
    signedIn = Boolean(session?.user?.email);
  } catch {
    signedIn = false;
  }

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-1 sm:px-6">
        <Link
          href={signedIn ? "/inbox" : "/"}
          className="inline-flex min-h-11 items-center gap-2 rounded-md font-extrabold tracking-tight text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-50"
        >
          <Image
            src={`/brand/${BRAND_VARIANT}/logomark.svg`}
            alt=""
            width={28}
            height={28}
            className="h-7 w-auto"
          />
          WitUS Inbox
        </Link>
        <nav aria-label="Account" className="flex items-center gap-1">
          {signedIn ? (
            <>
              <Link href="/inbox" className={linkClasses}>
                Inbox
              </Link>
              <SignOutButton className="min-h-11" />
            </>
          ) : (
            <Link href="/auth/sign-in" className={linkClasses}>
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
