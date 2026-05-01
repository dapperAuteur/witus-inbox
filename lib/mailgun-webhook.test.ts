import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyMailgunWebhook } from "./mailgun-webhook";

const SIGNING_KEY = "mg-signing-key-fixture-1234567890";

function freshSignature(timestamp: string, token: string, key = SIGNING_KEY): string {
  return createHmac("sha256", key).update(`${timestamp}${token}`).digest("hex");
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe("verifyMailgunWebhook", () => {
  it("accepts a fresh, correctly-signed payload", () => {
    const timestamp = nowSeconds();
    const token = "abcdef0123456789";
    const signature = freshSignature(timestamp, token);
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp, token, signature })
    ).toBe(true);
  });

  it("rejects when the signing key is wrong", () => {
    const timestamp = nowSeconds();
    const token = "abcdef0123456789";
    const signature = freshSignature(timestamp, token, "different-key-entirely");
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp, token, signature })
    ).toBe(false);
  });

  it("rejects when the token is tampered", () => {
    const timestamp = nowSeconds();
    const token = "abcdef0123456789";
    const signature = freshSignature(timestamp, token);
    expect(
      verifyMailgunWebhook({
        signingKey: SIGNING_KEY,
        timestamp,
        token: token + "x",
        signature,
      })
    ).toBe(false);
  });

  it("rejects a stale timestamp (>5 min old)", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const token = "abcdef0123456789";
    const signature = freshSignature(stale, token);
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp: stale, token, signature })
    ).toBe(false);
  });

  it("rejects a future timestamp (>5 min ahead)", () => {
    const future = String(Math.floor(Date.now() / 1000) + 6 * 60);
    const token = "abcdef0123456789";
    const signature = freshSignature(future, token);
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp: future, token, signature })
    ).toBe(false);
  });

  it("rejects an unparseable timestamp", () => {
    const token = "abcdef0123456789";
    // Sign with a real timestamp but pass a garbage timestamp through verify.
    const signature = freshSignature("1700000000", token);
    expect(
      verifyMailgunWebhook({
        signingKey: SIGNING_KEY,
        timestamp: "not-a-number",
        token,
        signature,
      })
    ).toBe(false);
  });

  it("rejects when any required field is missing or empty", () => {
    const timestamp = nowSeconds();
    const token = "abcdef0123456789";
    const signature = freshSignature(timestamp, token);

    // Empty signing key
    expect(verifyMailgunWebhook({ signingKey: "", timestamp, token, signature })).toBe(false);
    // Empty timestamp
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp: "", token, signature })
    ).toBe(false);
    // Empty token
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp, token: "", signature })
    ).toBe(false);
    // Empty signature
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp, token, signature: "" })
    ).toBe(false);
  });

  it("rejects a length-mismatched signature", () => {
    const timestamp = nowSeconds();
    const token = "abcdef0123456789";
    expect(
      verifyMailgunWebhook({
        signingKey: SIGNING_KEY,
        timestamp,
        token,
        signature: "tooshort",
      })
    ).toBe(false);
  });

  it("rejects a same-length but mismatched signature", () => {
    const timestamp = nowSeconds();
    const token = "abcdef0123456789";
    // 64 hex chars (SHA-256 length) but unrelated to any real signature
    const fakeSignature = "0".repeat(64);
    expect(
      verifyMailgunWebhook({
        signingKey: SIGNING_KEY,
        timestamp,
        token,
        signature: fakeSignature,
      })
    ).toBe(false);
  });

  it("uses the literal concatenation 'timestamp + token' (no separator)", () => {
    // Mailgun's documented format. If anyone changes the impl to add a
    // separator (like our own HMAC's "."), this test catches it.
    const timestamp = nowSeconds();
    const token = "abcdef0123456789";
    const correct = createHmac("sha256", SIGNING_KEY).update(`${timestamp}${token}`).digest("hex");
    const withDot = createHmac("sha256", SIGNING_KEY).update(`${timestamp}.${token}`).digest("hex");
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp, token, signature: correct })
    ).toBe(true);
    expect(
      verifyMailgunWebhook({ signingKey: SIGNING_KEY, timestamp, token, signature: withDot })
    ).toBe(false);
  });
});
