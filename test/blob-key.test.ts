import { describe, expect, it } from "vitest";
import { decodeBlobKey, encodeBlobKey } from "@/lib/blob-key";

describe("blob key codec", () => {
  it("leaves ASCII keys untouched", () => {
    expect(encodeBlobKey("sites/s_a/v_b/assets/app.js")).toBe("sites/s_a/v_b/assets/app.js");
    expect(decodeBlobKey("sites/s_a/v_b/assets/app.js")).toBe("sites/s_a/v_b/assets/app.js");
  });

  it("produces ASCII-only keys for Arabic names and round-trips them", () => {
    const key = "sites/s_t6pbrD0fx5Q8Lieb/v_RM4SmoR13s2tzBiF/مشاريع_الإنتاج_البسيط_عرض_تفاعلي_جديد.html";
    const encoded = encodeBlobKey(key);
    expect(encoded).toMatch(/^[\x20-\x7e]+$/);
    expect(encoded.endsWith(".html")).toBe(true);
    expect(decodeBlobKey(encoded)).toBe(key);
  });

  it("round-trips non-ASCII folders and mixed segments", () => {
    const key = "sites/s_a/v_b/موقع/صور/café ☕.png";
    const encoded = encodeBlobKey(key);
    expect(encoded).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeBlobKey(encoded)).toBe(key);
  });

  it("does not decode segments it does not recognise", () => {
    expect(decodeBlobKey("a/__u_!!!/b.html")).toBe("a/__u_!!!/b.html");
  });
});
