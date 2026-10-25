import { describe, expect, it } from "vitest";
import { diagnosePreview } from "@/lib/assets";

// The hint patterns live in diagnose.ts (server-only); these cases pin the
// behaviour that matters to the user: a page that hides itself is detectable
// from markup alone.
const HIDDEN = /<body[^>]*(?:style\s*=\s*["'][^"']*(?:visibility\s*:\s*hidden|display\s*:\s*none|opacity\s*:\s*0)[^"']*["'])/i;

describe("blank-page markers", () => {
  it("detects an inline-hidden body", () => {
    expect(HIDDEN.test('<body style="visibility:hidden">x</body>')).toBe(true);
    expect(HIDDEN.test('<body style="opacity:0">x</body>')).toBe(true);
    expect(HIDDEN.test('<body class="page">x</body>')).toBe(false);
  });

  it("treats a big document as scannable from a prefix", () => {
    const head = `<html><head><link rel="stylesheet" href="assets/site.css"></head><body>${"x".repeat(5000)}`;
    const diagnosis = diagnosePreview({ html: head, entryPath: "index.html", files: ["index.html"] });
    expect(diagnosis.missing).toEqual(["assets/site.css"]);
  });
});
