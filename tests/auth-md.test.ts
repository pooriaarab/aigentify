import { describe, expect, it } from "vitest";
import { generate } from "../src/generators/index.js";

describe("auth-md generator", () => {
  it("produces a markdown auth guide the audit accepts", () => {
    const md = generate("auth-md", { name: "Acme", repository: "https://github.com/acme/acme" });
    // The audit passes auth-md when the body starts with '#' and describes auth.
    expect(md.trimStart().startsWith("#")).toBe(true);
    expect(md).toContain("Acme — Agent Authentication");
    expect(md).toContain("Authorization: Bearer");
    expect(md).toMatch(/\|\s*401\s*\|/);
  });

  it("renders an agent signup call when signupUrl is set", () => {
    const md = generate("auth-md", {
      name: "Acme",
      repository: "https://github.com/acme/acme",
      signupUrl: "https://acme.com/api/v1/agent/signup",
      apiBaseUrl: "https://acme.com/api/public/v1",
    });
    expect(md).toContain("POST https://acme.com/api/v1/agent/signup");
    expect(md).toContain("REST API base: https://acme.com/api/public/v1");
  });

  it("falls back to out-of-band guidance without signupUrl", () => {
    const md = generate("auth-md", { name: "Acme", repository: "https://github.com/acme/acme" });
    expect(md).toContain("supplied out of band");
    expect(md).not.toContain("POST ");
  });
});
