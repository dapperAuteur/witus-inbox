import { describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_IDS,
  archiveNotice,
  isSameOrigin,
  parseArchiveForm,
  parseArchiveJson,
  returnUrlWithNotice,
  safeReturnPath,
} from "./archive";
import { parseInboxQuery, serializeInboxQuery } from "./inbox-query";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function form(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("the bulk archive form", () => {
  it("archives many at once and returns to the same view", () => {
    expect(
      parseArchiveForm(form([["id", A], ["id", B], ["id", A], ["action", "archive"], ["return", "/inbox?kind=bug&page=2"]])),
    ).toEqual({ ids: [A, B], archived: true, returnTo: "/inbox?kind=bug&page=2" });
  });

  it("unarchives", () => {
    expect(parseArchiveForm(form([["id", A], ["action", "unarchive"]]))?.archived).toBe(false);
  });

  it("refuses nothing ticked, a bad id, an unknown action, or too many ids", () => {
    expect(parseArchiveForm(form([["action", "archive"]]))).toBeNull();
    expect(parseArchiveForm(form([["id", "not-a-uuid"], ["action", "archive"]]))).toBeNull();
    expect(parseArchiveForm(form([["id", A], ["action", "delete"]]))).toBeNull();
    const many = Array.from({ length: MAX_ARCHIVE_IDS + 1 }, (_, i) =>
      ["id", `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`] as [string, string],
    );
    expect(parseArchiveForm(form([...many, ["action", "archive"]]))).toBeNull();
  });
});

describe("the JSON body", () => {
  it("takes ids and a boolean", () => {
    expect(parseArchiveJson({ ids: [A], archived: false })).toEqual({ ids: [A], archived: false, returnTo: "/inbox" });
    expect(parseArchiveJson({ ids: [A], archived: "yes" })).toBeNull();
    expect(parseArchiveJson({ ids: [], archived: true })).toBeNull();
    expect(parseArchiveJson(null)).toBeNull();
  });
});

describe("where a form post may send the browser back to", () => {
  it("only to /inbox paths on this site", () => {
    expect(safeReturnPath("/inbox")).toBe("/inbox");
    expect(safeReturnPath("/inbox?view=archived")).toBe("/inbox?view=archived");
    expect(safeReturnPath(`/inbox/${A}`)).toBe(`/inbox/${A}`);
    for (const bad of ["https://evil.example/inbox", "//evil.example", "/inboxevil", "/inbox//evil.example", "/inbox\\evil", "/auth/sign-in", 42, null]) {
      expect(safeReturnPath(bad)).toBe("/inbox");
    }
  });

  it("adds a one-time notice that the saved view does not keep", () => {
    const back = returnUrlWithNotice("/inbox?kind=bug&page=2", true, 3);
    expect(back).toBe("/inbox?kind=bug&page=2&done=archived&n=3");
    const view = parseInboxQuery(new URL(back, "https://x.invalid").searchParams);
    expect(serializeInboxQuery(view).toString()).toBe("kind=bug&page=2");
  });

  it("says what happened", () => {
    expect(archiveNotice("archived", "3")).toBe("Archived 3 submissions. They are under Archived.");
    expect(archiveNotice("unarchived", "1")).toBe("Moved 1 submission back to the inbox.");
    expect(archiveNotice("deleted", "1")).toBeNull();
    expect(archiveNotice(undefined, undefined)).toBeNull();
  });
});

describe("cross-site form posts", () => {
  it("are refused when the Origin is another host", () => {
    expect(isSameOrigin("https://inbox.witus.online", "inbox.witus.online")).toBe(true);
    expect(isSameOrigin("https://evil.example", "inbox.witus.online")).toBe(false);
    expect(isSameOrigin("null", "inbox.witus.online")).toBe(false);
    expect(isSameOrigin(null, "inbox.witus.online")).toBe(true);
  });
});
