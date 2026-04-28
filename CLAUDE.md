## ⚠️ Ecosystem repo identity (don't confuse these)

The site **brandanthonymcdonald.com** (BAM's personal portfolio) lives in `/Users/bam/Code_NOiCloud/ai-builds/claude/bam-landing-page/`, **NOT** `bam-portfolio`. A stray directory at `/Users/bam/Code_NOiCloud/projects/bam-portfolio/` exists from a prior misplaced `Write` call (parent dirs auto-created); it is not a real repo. When asked to work on the brandanthonymcdonald.com codebase, target `bam-landing-page`.

This mistake has been made more than once. If you're about to write a file under `projects/bam-portfolio/` or refer to it as the BAM portfolio repo, stop and re-read this note.

---

## Operator-task rule: capture user actions in `./plans/user-tasks/`

When Claude proposes work that needs BAM to do something outside the editor (account signup, API key, DNS change, vendor dashboard, env-var rotation, secret generation, PR review/merge, etc.), Claude MUST create a `./plans/user-tasks/NN-slug.md` file in this repo. **No exceptions for "small" steps.**

Required sections per task file: **Scope tag** · **What + why** (with explicit *what this blocks* detail and any hard deadline) · **Steps** · **What Claude will use** · **How to mark done** · **Related**.

Update `./plans/user-tasks/00-descriptions.md` index with columns `# | Title | Scope | Blocks | Status`. The `Blocks` column is non-negotiable; that's the column BAM scans to triage the queue.

This repo's queue is one of the reference implementations (alongside witus and bam-landing-page). Full rule with rationale: `/Users/bam/Code_NOiCloud/ai-builds/gemini/witus/CLAUDE.md` §"Operator-task rule".

**Ecosystem-wide tasks** (Keap, IRL events, weekly retros, consultant reconciliation, cross-product decisions) live in the canonical witus queue at `gemini/witus/plans/user-tasks/`. **Repo-local tasks** (Inbox deploy, env vars, vendor outreach for inbox.witus.online) live here. Read the witus queue at session start before starting dependent work.

---

@AGENTS.md
