import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StatusBody = z.object({
  status: z.enum(["new", "in_progress", "replied", "waiting", "closed"]),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = StatusBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const updated = await getDb()
      .update(submissions)
      .set({ status: parsed.data.status })
      .where(eq(submissions.id, id))
      .returning({ id: submissions.id });
    if (updated.length === 0) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }
    console.log("[status] source=- id=%s status=%s", id, parsed.data.status);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[status] update failed id=%s err=%s", id, code);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
