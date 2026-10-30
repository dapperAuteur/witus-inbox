import { describe, expect, it } from "vitest";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DEFAULT_QUERY,
  KINDS,
  PAGE_SIZE,
  buildConditions,
  hasFilters,
  inboxHref,
  kindsOf,
  orderByFor,
  pageCount,
  parseDate,
  parseInboxQuery,
  serializeInboxQuery,
  toggle,
} from "./inbox-query";

const dialect = new PgDialect();
const render = (q: Parameters<typeof buildConditions>[0], omit?: Parameters<typeof buildConditions>[1]) => {
  const c = buildConditions(q, omit);
  return c.length ? dialect.sqlToQuery(and(...c)!) : { sql: "", params: [] };
};

describe("natural kinds", () => {
  it("sorts the form types in the Inbox on 2026-10-29 the way a person would", () => {
    expect(kindsOf("learn-witus-problem-report")).toEqual(["bug"]);
    expect(kindsOf("invest-witus-feature-request")).toEqual(["feature"]);
    expect(kindsOf("contact")).toEqual(["question"]);
    expect(kindsOf("waitlist")).toEqual(["waitlist"]);
    expect(kindsOf("waitlist-signup")).toEqual(["waitlist"]);
    expect(kindsOf("bvc-pilot-signup")).toEqual(["waitlist"]);
    expect(kindsOf("learn-course-notify")).toEqual(["waitlist"]);
    expect(kindsOf("learn-course-interest:expert")).toEqual(["waitlist"]);
    expect(kindsOf("Bug")).toEqual(["bug"]);
  });

  it("leaves form types that are none of the four to the exact form type filter", () => {
    for (const t of ["hire", "partner", "client-intake", "learn-witus-email:magic-link"]) {
      expect(kindsOf(t)).toEqual([]);
    }
  });

  it("uses only plain alternation, so Postgres ~* and JS RegExp agree", () => {
    for (const { pattern } of Object.values(KINDS)) {
      expect(pattern).toMatch(/^[a-z|:-]+$/);
    }
  });
});

describe("reading the URL", () => {
  it("is the default view for an empty URL", () => {
    expect(parseInboxQuery(new URLSearchParams())).toEqual(DEFAULT_QUERY);
  });

  it("reads every parameter, repeatable ones included", () => {
    const q = parseInboxQuery(
      new URLSearchParams(
        "view=archived&kind=bug&kind=feature&source=invest-witus&form_type=contact&priority=high&status=new&q=%20acme%20&from=2026-10-01&to=2026-10-29&sort=priority&page=3",
      ),
    );
    expect(q).toEqual({
      view: "archived",
      kinds: ["bug", "feature"],
      sources: ["invest-witus"],
      formTypes: ["contact"],
      priorities: ["high"],
      status: "new",
      q: "acme",
      from: "2026-10-01",
      to: "2026-10-29",
      sort: "priority",
      page: 3,
    });
  });

  it("reads status=any (every status, closed included) and round-trips it", () => {
    const q = parseInboxQuery(new URLSearchParams("status=any"));
    expect(q.status).toBe("any");
    expect(serializeInboxQuery(q).toString()).toBe("status=any");
    expect(hasFilters(q)).toBe(true);
    expect(parseInboxQuery(new URLSearchParams("status=everything")).status).toBeNull();
  });

  it("accepts Next's searchParams object shape", () => {
    expect(parseInboxQuery({ kind: ["bug", "bug"], source: "witus-learn" })).toMatchObject({
      kinds: ["bug"],
      sources: ["witus-learn"],
    });
  });

  it("drops anything malformed instead of failing", () => {
    const q = parseInboxQuery(
      new URLSearchParams("view=deleted&kind=spam&source=%3Cscript%3E&status=gone&sort=random&page=-2&from=2026-02-30&to=yesterday"),
    );
    expect(q).toEqual(DEFAULT_QUERY);
    expect(parseInboxQuery(new URLSearchParams("page=abc")).page).toBe(1);
    expect(parseInboxQuery(new URLSearchParams("page=999999")).page).toBe(10_000);
  });

  it("swaps a backwards date range rather than showing nothing", () => {
    expect(parseInboxQuery(new URLSearchParams("from=2026-10-29&to=2026-10-01"))).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-29",
    });
  });

  it("caps the search length", () => {
    expect(parseInboxQuery(new URLSearchParams(`q=${"x".repeat(500)}`)).q).toHaveLength(100);
  });

  it("only takes real calendar dates", () => {
    expect(parseDate("2026-10-29")).toBe("2026-10-29");
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("2026-1-1")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe("writing the URL (bookmarkable views)", () => {
  it("round-trips", () => {
    const url = "view=archived&kind=bug&source=invest-witus&priority=high&status=new&q=acme&from=2026-10-01&sort=oldest&page=2";
    const q = parseInboxQuery(new URLSearchParams(url));
    expect(parseInboxQuery(serializeInboxQuery(q))).toEqual(q);
  });

  it("leaves out defaults, so the plain inbox is /inbox", () => {
    expect(inboxHref(DEFAULT_QUERY)).toBe("/inbox");
    expect(serializeInboxQuery(DEFAULT_QUERY).toString()).toBe("");
  });

  it("goes back to page 1 on any change except paging", () => {
    const onPage4 = { ...DEFAULT_QUERY, page: 4 };
    expect(inboxHref(onPage4, { kinds: ["bug"] })).toBe("/inbox?kind=bug");
    expect(inboxHref(onPage4, { page: 5 })).toBe("/inbox?page=5");
  });

  it("combines chips across groups: Bugs + one app", () => {
    const bugs = parseInboxQuery(new URLSearchParams("kind=bug"));
    expect(inboxHref(bugs, { sources: toggle(bugs.sources, "invest-witus") })).toBe(
      "/inbox?kind=bug&source=invest-witus",
    );
  });

  it("toggles a chip off when clicked again", () => {
    expect(toggle(["bug", "feature"], "bug")).toEqual(["feature"]);
    expect(toggle(["feature"], "bug")).toEqual(["feature", "bug"]);
  });

  it("knows when the view is filtered", () => {
    expect(hasFilters(DEFAULT_QUERY)).toBe(false);
    expect(hasFilters({ ...DEFAULT_QUERY, sort: "oldest", page: 3, view: "archived" })).toBe(false);
    expect(hasFilters({ ...DEFAULT_QUERY, to: "2026-10-29" })).toBe(true);
  });
});

describe("the SQL a view runs", () => {
  it("hides archived rows by default and shows only them in the Archived view", () => {
    expect(render(DEFAULT_QUERY).sql).toContain('"submission"."archived_at" is null');
    expect(render({ ...DEFAULT_QUERY, view: "archived" }).sql).toContain('"submission"."archived_at" is not null');
  });

  it("hides closed rows by default; the Closed chip and status=any show them", () => {
    expect(render(DEFAULT_QUERY)).toMatchObject({
      sql: '("submission"."archived_at" is null and "submission"."status" <> $1)',
      params: ["closed"],
    });
    expect(render({ ...DEFAULT_QUERY, view: "archived" }).sql).toContain('"submission"."status" <> $1');
    const closed = render({ ...DEFAULT_QUERY, status: "closed" });
    expect(closed.sql).toContain('"submission"."status" = $1');
    expect(closed.sql).not.toContain("<>");
    expect(closed.params).toEqual(["closed"]);
    expect(render({ ...DEFAULT_QUERY, status: "any" }).sql).toBe('"submission"."archived_at" is null');
    // A chip count leaves the status group out entirely, closed-hiding included.
    expect(render(DEFAULT_QUERY, "status").sql).not.toContain('"status"');
  });

  it("ORs within a group and ANDs across groups", () => {
    const { sql, params } = render({ ...DEFAULT_QUERY, kinds: ["bug", "feature"], sources: ["invest-witus"] });
    expect(sql).toContain('("submission"."form_type" ~* $1 or "submission"."form_type" ~* $2)');
    expect(sql).toContain('and "submission"."source" in ($3)');
    // "closed" last: the default list hides closed rows (see the closed test below).
    expect(params).toEqual([KINDS.bug.pattern, KINDS.feature.pattern, "invest-witus", "closed"]);
  });

  it("searches name, email, form type and the payload text, with LIKE wildcards escaped", () => {
    const { sql, params } = render({ ...DEFAULT_QUERY, q: "50%_off" });
    expect(sql).toContain('"submission"."payload"::text ilike');
    expect(sql).toContain('"submission"."form_type" ilike');
    expect(params).toContain("%50\\%\\_off%");
  });

  it("treats the end date as inclusive (before the start of the next UTC day)", () => {
    const { sql, params } = render({ ...DEFAULT_QUERY, from: "2026-10-01", to: "2026-10-31" });
    expect(sql).toContain('"submission"."received_at" >= $1');
    expect(sql).toContain('"submission"."received_at" < $2');
    expect(params).toEqual(["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "closed"]);
  });

  it("leaves one group out for that group's chip counts", () => {
    const q = { ...DEFAULT_QUERY, kinds: ["bug" as const], sources: ["invest-witus"], status: "new" as const };
    expect(render(q, "kind").sql).not.toContain("~*");
    expect(render(q, "source").sql).not.toContain('"source" in');
    expect(render(q, "status").sql).not.toContain('"status" =');
    expect(render(q, "view").sql).not.toContain("archived_at");
  });

  it("sorts with a stable tiebreak so pages never repeat or skip a row", () => {
    for (const sort of ["newest", "oldest", "priority", "source", "kind"] as const) {
      const order = orderByFor(sort).map((s) => dialect.sqlToQuery(s).sql);
      expect(order.at(-1)).toMatch(/"submission"\."id" (asc|desc)/);
    }
    expect(dialect.sqlToQuery(orderByFor("priority")[0]).sql).toContain("when \"submission\".\"priority\" = 'high' then 0");
  });
});

describe("paging", () => {
  it("counts pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(980)).toBe(20);
  });
});
