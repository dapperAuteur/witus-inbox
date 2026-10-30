import { describe, expect, it } from "vitest";
import { MAX_ARCHIVE_IDS } from "./archive";
import { CONFIRM_VALUE, confirmPageIds, isAdminEmail, listReturnPath, parseDeleteForm, parseDeleteJson } from "./delete";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function form(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("the delete confirm form", () => {
  it("deletes only with confirm=delete", () => {
    expect(parseDeleteForm(form([["id", A], ["id", B], ["confirm", CONFIRM_VALUE], ["return", "/inbox?kind=bug"]]))).toEqual({
      ids: [A, B],
      returnTo: "/inbox?kind=bug",
    });
    // The list's bulk form posts action=archive|close to the archive route and has no
    // confirm field; a post like it must never delete.
    expect(parseDeleteForm(form([["id", A], ["action", "archive"]]))).toBeNull();
    expect(parseDeleteForm(form([["id", A], ["confirm", "yes"]]))).toBeNull();
  });

  it("refuses nothing selected, a bad id, or too many ids", () => {
    expect(parseDeleteForm(form([["confirm", CONFIRM_VALUE]]))).toBeNull();
    expect(parseDeleteForm(form([["id", "nope"], ["confirm", CONFIRM_VALUE]]))).toBeNull();
    const many = Array.from({ length: MAX_ARCHIVE_IDS + 1 }, (_, i) =>
      ["id", `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`] as [string, string],
    );
    expect(parseDeleteForm(form([...many, ["confirm", CONFIRM_VALUE]]))).toBeNull();
  });

  it("takes JSON with the same confirm field", () => {
    expect(parseDeleteJson({ ids: [A], confirm: CONFIRM_VALUE })).toEqual({ ids: [A], returnTo: "/inbox" });
    expect(parseDeleteJson({ ids: [A] })).toBeNull();
    expect(parseDeleteJson({ ids: [], confirm: CONFIRM_VALUE })).toBeNull();
    expect(parseDeleteJson(null)).toBeNull();
  });
});

describe("where a delete goes back to", () => {
  it("is always a list view, never the deleted item's page or another site", () => {
    expect(listReturnPath("/inbox?view=archived&page=2")).toBe("/inbox?view=archived&page=2");
    expect(listReturnPath(`/inbox/${A}`)).toBe("/inbox");
    expect(listReturnPath("/inbox/delete?id=" + A)).toBe("/inbox");
    expect(listReturnPath("https://evil.example/inbox")).toBe("/inbox");
    expect(listReturnPath(undefined)).toBe("/inbox");
  });

  it("drops an old notice so it is not shown twice", () => {
    expect(listReturnPath("/inbox?kind=bug&done=archived&n=3")).toBe("/inbox?kind=bug");
  });
});

describe("the confirm page's ids", () => {
  it("reads one or many, and refuses malformed ones", () => {
    expect(confirmPageIds(A)).toEqual([A]);
    expect(confirmPageIds([A, B, A])).toEqual([A, B]);
    expect(confirmPageIds(undefined)).toBeNull();
    expect(confirmPageIds([A, "x"])).toBeNull();
  });
});

describe("the admin check behind proxy.ts", () => {
  it("matches the admin's email, ignoring case and spaces", () => {
    expect(isAdminEmail("Owner@Example.com ", "owner@example.com")).toBe(true);
    expect(isAdminEmail("someone@example.com", "owner@example.com")).toBe(false);
    expect(isAdminEmail(undefined, "owner@example.com")).toBe(false);
    expect(isAdminEmail("owner@example.com", "")).toBe(false);
  });
});
