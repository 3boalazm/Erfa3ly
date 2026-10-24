import { describe, expect, it } from "vitest";
import { safeRelativePath, resolveInside, isJunkPath } from "@/lib/paths";

describe("safeRelativePath", () => {
  it("keeps ordinary nested paths", () => {
    expect(safeRelativePath("assets/app.js")).toBe("assets/app.js");
    expect(safeRelativePath("./index.html")).toBe("index.html");
    expect(safeRelativePath("a\\b\\c.txt")).toBe("a/b/c.txt");
  });

  it("rejects traversal and absolute paths", () => {
    for (const input of ["..", "../x", "a/../../b", "/etc/passwd", "C:\\windows\\system32", "a/./b", ""]) {
      expect(() => safeRelativePath(input), input).toThrow();
    }
  });

  it("rejects control characters and repository internals", () => {
    expect(() => safeRelativePath("a\u0000b")).toThrow();
    expect(() => safeRelativePath(".git/config")).toThrow();
    expect(() => safeRelativePath("node_modules/pkg/index.js")).toThrow();
  });

  it("rejects over-long paths", () => {
    expect(() => safeRelativePath("a/".repeat(600) + "x")).toThrow();
    expect(() => safeRelativePath("x".repeat(300))).toThrow();
  });
});

describe("resolveInside", () => {
  it("keeps resolved paths under the root", () => {
    expect(resolveInside("/data/blobs", "sites/a/b/index.html")).toBe("/data/blobs/sites/a/b/index.html");
    expect(() => resolveInside("/data/blobs", "../outside")).toThrow();
  });
});

describe("isJunkPath", () => {
  it("knows OS droppings", () => {
    expect(isJunkPath("__MACOSX/x")).toBe(true);
    expect(isJunkPath("a/.DS_Store")).toBe(true);
    expect(isJunkPath("a/._index.html")).toBe(true);
    expect(isJunkPath("a/index.html")).toBe(false);
  });
});
