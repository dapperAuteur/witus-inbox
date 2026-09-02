import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";

// POST { email } — records a request for access to WitUS Inbox.
//
// WHY THIS IS NOT A NEW WAITLIST MECHANISM. This app HAS no waitlist table, and
// inventing one would be a second place to look. What it does have is the
// submissions pipeline it exists to serve: every sibling product POSTs signed
// form-submissions to /api/ingest, they land in the `submission` table, and BAM
// triages them at /inbox. So a request for access is written there, as a
// submission from this app itself — the same row shape, the same queue, the same
// status/reply tooling. It really is recorded, and BAM really will see it.
//
// WHY IT DOESN'T GO THROUGH /api/ingest. That route is the HMAC-authenticated door
// for OTHER origins; calling it from inside this process would mean giving this app
// a secret to talk to itself and a round trip to verify a signature over data it
// already trusts. Same table, one less moving part. It also means this row does not
// fire the triage-agent webhook /api/ingest fires — deliberate: an access request
// wants a human, not an LLM triage pass.
//
// PUBLIC BY NECESSITY. Whoever reaches this has just been refused a sign-in, so
// they have no session to authenticate with. The exposure is bounded by: an
// email-only body (no free text to abuse), strict validation, and a dedupe that
// makes a repeat submission from the same address a no-op rather than another row
// in BAM's queue. There is no rate limiter in this repo; see
// plans/user-tasks for the note about that.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The source slug this app writes under. Its own name — this row came from here. */
const SOURCE = "witus-inbox";
/** Matches the form_type sibling products already use for waitlist signups. */
const FORM_TYPE = "waitlist-signup";

const Body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email().max(255)),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "A valid email is required." },
      { status: 400 },
    );
  }

  const email = parsed.data.email;
  const db = getDb();

  try {
    // Idempotent on the address. The `submission` table has no unique constraint
    // (by design — sibling products legitimately submit the same form twice), so
    // the dedupe is done here rather than with onConflictDoNothing.
    const existing = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.source, SOURCE),
          eq(submissions.formType, FORM_TYPE),
          eq(submissions.submitterEmail, email),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Already on the list. Say the same thing as a fresh signup — there is
      // nothing for them to do differently, and it is true.
      return NextResponse.json({ ok: true });
    }

    await db.insert(submissions).values({
      source: SOURCE,
      formType: FORM_TYPE,
      submitterEmail: email,
      payload: { email, submitted_at: new Date().toISOString() },
      priority: "normal",
      // "manual" rather than "webhook": nothing was signed and nothing crossed an
      // origin. The enum's honest value for a row this app wrote itself.
      receivedVia: "manual",
    });
  } catch (err) {
    // Log the error CODE only. Drizzle puts query params — which here include the
    // submitter's email — into its default error shape; never surface that.
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[waitlist] insert failed err=%s", code);
    return NextResponse.json(
      { ok: false, error: "Could not record that right now. Please try again." },
      { status: 500 },
    );
  }

  console.log("[waitlist] recorded access request");
  return NextResponse.json({ ok: true });
}
