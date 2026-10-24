import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractZip, readZipEntry, ZipLimitError } from "@/lib/unzip";

const limits = { maxFiles: 5, maxFileBytes: 1024, maxTotalBytes: 2048 };

function archive(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content);
  return zipSync(entries);
}

describe("extractZip", () => {
  it("round-trips a small archive and skips junk", () => {
    const entries = extractZip(
      archive({
        "site/index.html": "<h1>hi</h1>",
        "__MACOSX/site/._index.html": "junk",
        "site/.DS_Store": "junk",
      }),
      limits,
    );
    expect(entries.map((entry) => entry.path)).toEqual(["site/index.html"]);
    expect(new TextDecoder().decode(entries[0].bytes)).toBe("<h1>hi</h1>");
  });

  it("refuses zip-slip entries", () => {
    expect(() => extractZip(archive({ "../evil.html": "x", "index.html": "ok" }), limits)).toThrow(ZipLimitError);
    expect(() => extractZip(archive({ "/abs.html": "x" }), limits)).toThrow(ZipLimitError);
  });

  it("enforces the file-count cap", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1) files[`f${index}.txt`] = "x";
    expect(() => extractZip(archive(files), limits)).toThrow(ZipLimitError);
  });

  it("enforces the per-file cap before inflation", () => {
    expect(() =>
      extractZip(archive({ "big.txt": "a".repeat(4096) }), limits),
    ).toThrow(ZipLimitError);
  });

  it("enforces the total cap", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 5; index += 1) files[`f${index}.txt`] = "a".repeat(900);
    expect(() => extractZip(archive(files), limits)).toThrow(ZipLimitError);
  });

  it("rejects an archive with no usable files", () => {
    expect(() => extractZip(archive({ "dir/": "" }), limits)).toThrow(ZipLimitError);
  });
});

describe("readZipEntry", () => {
  it("reads package.json from a nested folder", () => {
    const bytes = archive({ "app/package.json": '{"scripts":{"start":"node ."}}', "app/index.html": "ok" });
    expect(readZipEntry(bytes, "package.json")).toContain('"start"');
  });

  it("returns null when absent", () => {
    expect(readZipEntry(archive({ "index.html": "ok" }), "package.json")).toBeNull();
  });
});
