import { expect } from "@playwright/test";
import { defineTutorial } from "./tutorial";

// "Feedback that never falls through the cracks" — the OPERATOR half of Tutorial C from witus
// plans/31-tutorial-narration-scripts.md (steps 6–10 there; numbered 1–5 here, narration VERBATIM).
// The user half (widget → send) is recorded in flashlearn-ai as feedback-user; that tutorial
// creates the "[TUTORIAL]" submissions this spec triages. Selectors come from the 2026-08-16 flow
// map of this repo (app/inbox/page.tsx, app/inbox/[id]/page.tsx, components/ReplyComposer.tsx,
// components/StatusControl.tsx).
//
// AUTH: every /inbox surface is gated to the single ADMIN_EMAIL account, so requiresAuth: true —
// record with BAM's admin storage state via TUTORIAL_STORAGE_STATE (see
// playwright.tutorial.config.ts header). Without it this spec SKIPS.
//
// ============================== SAFETY RULES (do not relax) ==============================
// 1. MUTATION GATE — this recording navigates and TYPES, but the ONLY step that mutates
//    anything is the reply send. That single click is gated behind TUTORIAL_SEND_REPLY=1.
//    Default (flag unset): type the reply text, screenshot, do NOT click "Send reply".
//    A sent reply emails a REAL submitter. With the flag on, BAM must have confirmed the
//    selected "[TUTORIAL]" submission's submitter is his own test account before recording.
//    The step is built conditionally (per the harness pattern) so marks.json matches what
//    actually happened on screen.
// 2. TARGET SELECTION — the spec only ever opens the FIRST row whose text contains
//    "[TUTORIAL]" (created by the FlashLearn feedback-user tutorial). If none exists the spec
//    FAILS with a clear message telling the operator to run that tutorial first — it must
//    never fall back to an arbitrary real submission.
// 3. PRIVACY — never assert on or screenshot other submitters' rows beyond their incidental
//    presence in the list view; the detail view opened (and screenshotted close-up) must be
//    the [TUTORIAL] one. Blur/avoid real submitter emails when publishing the recording.
// =========================================================================================
//
// SELECTOR NOTE: /inbox list rows render submitterName ?? submitterEmail (the payload subject
// is NOT shown in the list), so "[TUTORIAL]" must appear in the submitter name or email of the
// row created by the feedback-user tutorial. The failure message below covers the mismatch case.

const SEND_REPLY = process.env.TUTORIAL_SEND_REPLY === "1";

const REPLY_TEXT =
  "Thanks for the report — I can reproduce it and a fix is on the way. I'll follow up here when it ships.";

const NO_TUTORIAL_ROW_MSG =
  "No inbox row containing \"[TUTORIAL]\" was found. Run the FlashLearn feedback-user tutorial " +
  "first (it submits the [TUTORIAL] bug this recording triages), then re-run this spec. " +
  "This spec never opens real submitters' submissions.";

// The [TUTORIAL] row — the only row this tutorial is allowed to open (safety rule 2).
const tutorialRow = (page: import("@playwright/test").Page) =>
  page.getByRole("link").filter({ hasText: "[TUTORIAL]" }).first();

defineTutorial(
  {
    slug: "feedback-operator",
    title: "Feedback that never falls through the cracks",
    startPath: "/inbox",
    requiresAuth: true,
  },
  [
    {
      // plans/31 Tutorial C step 6
      title: "One inbox for every app",
      narration:
        "Every app in the ecosystem reports into one inbox. Your bug just arrived, marked high — which also pings my phone by text.",
      action: async (page) => {
        await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
        // Filter pills by source (the "Source" fieldset legend from app/inbox/page.tsx).
        await expect(page.getByText("Source", { exact: true })).toBeVisible();
        // Safety rule 2: locate the [TUTORIAL] row; fail loudly if it doesn't exist.
        const row = tutorialRow(page);
        await expect(row, NO_TUTORIAL_ROW_MSG).toBeVisible();
        // The bug arrived high-priority: red "High" badge on the tutorial row only (rule 3 —
        // no assertions against other submitters' rows).
        await expect(row.getByText("High", { exact: true })).toBeVisible();
        await row.scrollIntoViewIfNeeded();
      },
    },
    {
      // plans/31 Tutorial C step 7
      title: "Open the submission",
      narration:
        "I see exactly what you sent, with the context the app added. Behind the scenes, an AI triage agent has already classified it and drafted a suggested response — but nothing goes out without me approving it.",
      action: async (page) => {
        await tutorialRow(page).click();
        await expect(page.getByRole("heading", { name: "Submitted data" })).toBeVisible();
        // Safety rule 3: the detail we opened must be the [TUTORIAL] submission — its subject
        // (payload) or submitter name carries the marker.
        await expect(page.getByText("[TUTORIAL]").first()).toBeVisible();
        await expect(page.getByLabel("Status")).toBeVisible();
        await expect(page.getByText(/^Reply to/).first()).toBeVisible();
      },
    },
    // plans/31 Tutorial C step 8 — THE ONLY MUTATING STEP, built conditionally (safety rule 1)
    // so marks.json records what the screen actually showed.
    SEND_REPLY
      ? {
          title: "Reply from the inbox",
          narration:
            "My answer lands in your email, and you can just hit reply — that reply comes right back into this thread's history.",
          action: async (page) => {
            // TUTORIAL_SEND_REPLY=1: BAM has verified the submitter is his own test account.
            // This click sends a REAL email to the submission's submitter_email.
            await page.getByLabel(/^Reply to/).fill(REPLY_TEXT);
            await page.getByRole("button", { name: "Send reply" }).click();
            // The reply route flips the submission to "replied" (app/api/submissions/[id]/reply);
            // the header StatusBadge re-renders on router.refresh().
            await expect(page.getByText("Replied").first()).toBeVisible({ timeout: 30_000 });
          },
        }
      : {
          title: "Reply from the inbox",
          narration:
            "My answer lands in your email, and you can just hit reply — that reply comes right back into this thread's history.",
          action: async (page) => {
            // Default DRY RUN: type the reply and hold the frame — do NOT click "Send reply".
            // Re-record with TUTORIAL_SEND_REPLY=1 to capture the real send + status flip.
            await page.getByLabel(/^Reply to/).fill(REPLY_TEXT);
            await expect(page.getByRole("button", { name: "Send reply" })).toBeEnabled();
          },
        },
    {
      // plans/31 Tutorial C step 9
      title: "History in one place",
      narration:
        "The whole conversation stays in one place until it's resolved. Statuses, not vibes: new, in progress, replied, closed.",
      action: async (page) => {
        if (SEND_REPLY) {
          // The sent reply now shows in the History section.
          const history = page.getByRole("heading", { name: "History" });
          await expect(history).toBeVisible();
          await history.scrollIntoViewIfNeeded();
        } else {
          // Dry run: no reply was sent, so History may not exist yet — hold on the status
          // control (the "statuses, not vibes" line) instead.
          const status = page.getByLabel("Status");
          await status.scrollIntoViewIfNeeded();
          await expect(status).toBeVisible();
        }
      },
    },
    {
      // plans/31 Tutorial C step 10. The [SCREEN] in plans/31 is the FlashLearnAI widget —
      // that closing shot is recorded by the flashlearn-ai feedback-user tutorial (different
      // app, different signed-in session). This operator half closes on the inbox list so the
      // narration has a timed hold; BAM splices the widget shot when composing the full
      // Tutorial C cut.
      title: "Back to the FlashLearnAI widget",
      narration: "One button, a real thread, a human answer. That's the deal in every WitUS app.",
      action: async (page) => {
        await page.goto("/inbox");
        await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
      },
    },
  ],
);
