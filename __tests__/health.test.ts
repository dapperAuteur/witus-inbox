import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/db", () => ({
  getDb: () => ({ execute }),
}));

const { GET } = await import("@/app/api/health/route");

describe("GET /api/health", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns 200 and ok:true when the database answers", async () => {
    execute.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("sets no-store so a monitor never reads a cached green", async () => {
    execute.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();

    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("returns 503 with a generic token when the database is unreachable", async () => {
    execute.mockRejectedValue(
      new Error(
        "connect ECONNREFUSED postgres://user:sup3rs3cret@db.example.com:5432/inbox"
      )
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ ok: false, error: "database_unreachable" });
  });

  it("never leaks the raw error text, including credentials", async () => {
    execute.mockRejectedValue(
      new Error("password authentication failed for user 'inbox' sup3rs3cret")
    );

    const res = await GET();
    const raw = await res.text();

    expect(raw).not.toContain("sup3rs3cret");
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("db.example.com");
  });

  it("returns no submission data in the healthy response", async () => {
    execute.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["checkedAt", "ok", "service"]);
  });
});
