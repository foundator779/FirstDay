import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createTranscriptHash } from "@firstday/contracts";

it("hashes the exact transcript bytes identically on the portable and Node implementations", () => {
  for (const text of ["", "cafÃ©\nðŸ", "line one\nline two", "line one\r\nline two"]) {
    expect(createTranscriptHash(text)).toBe(createHash("sha256").update(text).digest("hex"));
  }
});

