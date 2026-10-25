import { describe, expect, it } from "vitest";
import { diagnosePreview, extractAssetRefs } from "@/lib/assets";

describe("extractAssetRefs", () => {
  it("resolves relative references against the entry point", () => {
    const html = `
      <link rel="stylesheet" href="assets/app.css">
      <script src="assets/app.js"></script>
      <img src="./img/logo.png" srcset="img/logo@2x.png 2x">
    `;
    const refs = extractAssetRefs(html, "index.html");
    expect(refs.map((ref) => ref.resolved)).toEqual(["assets/app.css", "assets/app.js", "img/logo.png", "img/logo@2x.png"]);
  });

  it("ignores external, inline and anchor references", () => {
    const html = `<a href="#top">x</a><a href="https://example.com">y</a><img src="data:image/png;base64,AA">`;
    expect(extractAssetRefs(html, "index.html").every((ref) => ref.resolved === null)).toBe(true);
  });

  it("walks up from a nested page", () => {
    const refs = extractAssetRefs(`<link href="../css/style.css">`, "pages/about.html");
    expect(refs[0].resolved).toBe("css/style.css");
  });
});

describe("diagnosePreview", () => {
  it("reports assets that were never uploaded", () => {
    const diagnosis = diagnosePreview({
      html: `<link href="assets/css/style.css"><script src="assets/js/app.js"></script><img src="logo.png">`,
      entryPath: "index_en_about_designer_lightbox.html",
      files: ["index_en_about_designer_lightbox.html"],
    });
    expect(diagnosis.missing).toEqual(["assets/css/style.css", "assets/js/app.js", "logo.png"]);
    expect(diagnosis.looksFine).toBe(false);
  });

  it("is quiet when everything resolves", () => {
    const diagnosis = diagnosePreview({
      html: `<link href="assets/app.css"><h1>hi</h1>`,
      entryPath: "index.html",
      files: ["index.html", "assets/app.css"],
    });
    expect(diagnosis.missing).toEqual([]);
    expect(diagnosis.looksFine).toBe(true);
  });

  it("flags domain-root references, which no preview URL can satisfy", () => {
    const diagnosis = diagnosePreview({
      html: `<link href="/assets/app.css">`,
      entryPath: "index.html",
      files: ["index.html", "assets/app.css"],
    });
    expect(diagnosis.absolute).toEqual(["/assets/app.css"]);
  });

  it("flags APIs an opaque origin forbids", () => {
    const diagnosis = diagnosePreview({
      html: `<script>localStorage.getItem("theme");history.replaceState({},"","/x")</script>`,
      entryPath: "index.html",
      files: ["index.html"],
    });
    expect(diagnosis.opaqueApis).toContain("localStorage");
    expect(diagnosis.opaqueApis.some((name) => name.startsWith("history"))).toBe(true);
  });
});
