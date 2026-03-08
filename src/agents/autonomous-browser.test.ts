import { describe, expect, it } from "vitest";
import { extractFinalAnswerText, isDomainAllowed, isSafeBrowserUrl } from "./autonomous-browser.js";

describe("isSafeBrowserUrl", () => {
  it("allows standard http/https urls", () => {
    expect(isSafeBrowserUrl("https://docs.openclaw.ai")).toBe(true);
    expect(isSafeBrowserUrl("http://example.com/path?q=1")).toBe(true);
  });

  it("blocks unsafe protocols", () => {
    expect(isSafeBrowserUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeBrowserUrl("data:text/html,hello")).toBe(false);
    expect(isSafeBrowserUrl("file:///tmp/test.txt")).toBe(false);
  });
});

describe("isDomainAllowed", () => {
  it("allows all domains when allowlist is not provided", () => {
    expect(isDomainAllowed("https://anywhere.example/path")).toBe(true);
  });

  it("enforces domain allowlist with subdomain support", () => {
    const allowlist = ["openclaw.ai"];
    expect(isDomainAllowed("https://openclaw.ai/docs", allowlist)).toBe(true);
    expect(isDomainAllowed("https://docs.openclaw.ai/configuration", allowlist)).toBe(true);
    expect(isDomainAllowed("https://evil-openclaw.ai", allowlist)).toBe(false);
    expect(isDomainAllowed("https://example.com", allowlist)).toBe(false);
  });
});

describe("extractFinalAnswerText", () => {
  it("extracts canonical final-answer prefixes", () => {
    expect(extractFinalAnswerText("FINAL: Done")).toBe("Done");
    expect(extractFinalAnswerText("FINAL_ANSWER: Resolved")).toBe("Resolved");
    expect(extractFinalAnswerText("Final answer: Complete")).toBe("Complete");
  });

  it("falls back to trimmed text", () => {
    expect(extractFinalAnswerText("  plain output  ")).toBe("plain output");
  });
});
