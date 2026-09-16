import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect.js";

/**
 * An unchecked `next` turns a real sign-in on the real domain into a phishing
 * hop. Every case below is a way of dressing an external destination up as a
 * relative path.
 */
describe("safeRedirectPath", () => {
  it("keeps a same-site path, with its query and fragment", () => {
    expect(safeRedirectPath("/admin/vendors")).toBe("/admin/vendors");
    expect(safeRedirectPath("/admin/orders?state=issue")).toBe("/admin/orders?state=issue");
    expect(safeRedirectPath("/admin/orders#TO-4192")).toBe("/admin/orders#TO-4192");
  });

  it("rejects an absolute URL", () => {
    expect(safeRedirectPath("https://evil.example/login")).toBe("/");
    expect(safeRedirectPath("http://evil.example")).toBe("/");
  });

  it("rejects a protocol-relative URL, which a browser treats as absolute", () => {
    expect(safeRedirectPath("//evil.example")).toBe("/");
    expect(safeRedirectPath("//evil.example/admin")).toBe("/");
  });

  it("rejects backslash forms that normalise into a host", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("\\\\evil.example")).toBe("/");
  });

  it("rejects a scheme hidden behind encoding", () => {
    expect(safeRedirectPath("/%2f%2fevil.example")).toBe("/");
    expect(safeRedirectPath("%2F%2Fevil.example")).toBe("/");
  });

  it("rejects anything carrying a scheme, even where it would be same-origin", () => {
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
    // `/javascript:alert(1)` is genuinely a same-origin path and would merely
    // 404. It is refused anyway: the value passes through a URL parser, a
    // redirect and a browser, and the cost of rejecting a path nobody has is
    // far below the cost of one of those three disagreeing about it.
    expect(safeRedirectPath("/javascript:alert(1)")).toBe("/");
    expect(safeRedirectPath("/https://evil.example")).toBe("/");
  });

  it("rejects paths that normalise into a protocol-relative URL", () => {
    // These pass every check on the input — they start with a single slash,
    // carry no scheme and no control characters — and only become
    // `//evil.example` once the URL parser resolves the `..` segments.
    expect(safeRedirectPath("/..//evil.example")).toBe("/");
    expect(safeRedirectPath("/%2e%2e//evil.example")).toBe("/");
    expect(safeRedirectPath("/a/../..//evil.example")).toBe("/");
    expect(safeRedirectPath("/..//..//evil.example")).toBe("/");
  });

  it("rejects control characters that could truncate a header", () => {
    expect(safeRedirectPath("/admin\nLocation: https://evil.example")).toBe("/");
    expect(safeRedirectPath("/admin\r\nSet-Cookie: x=1")).toBe("/");
  });

  it("rejects malformed percent-encoding rather than guessing", () => {
    expect(safeRedirectPath("/%")).toBe("/");
  });

  it("falls back for anything that is not a usable string", () => {
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
    expect(safeRedirectPath(42)).toBe("/");
    expect(safeRedirectPath(["/admin"])).toBe("/");
  });

  it("uses the caller's fallback when one is given", () => {
    expect(safeRedirectPath("https://evil.example", "/admin/vendors")).toBe("/admin/vendors");
  });
});
