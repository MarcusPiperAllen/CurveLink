const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeBaseUrl,
  getCorsOrigins,
  getHelpMessage,
  buildStatusCallbackUrl,
  mapTwilioStatus,
} = require("../migration-config");

test("normalizes the public base URL without retaining a trailing slash", () => {
  assert.equal(normalizeBaseUrl(" https://curvelink.example/ "), "https://curvelink.example");
});

test("uses PUBLIC_BASE_URL and local origins without a Replit fallback", () => {
  assert.deepEqual(getCorsOrigins({ PUBLIC_BASE_URL: "https://curvelink.example/" }), [
    "https://curvelink.example",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ]);
});

test("uses a trimmed explicit CORS list when provided", () => {
  assert.deepEqual(
    getCorsOrigins({ CORS_ORIGIN: "https://one.example/, https://two.example" }),
    ["https://one.example", "https://two.example"]
  );
});

test("builds the HELP response from PUBLIC_BASE_URL", () => {
  const message = getHelpMessage({ PUBLIC_BASE_URL: "https://curvelink.example/" });
  assert.match(message, /https:\/\/curvelink\.example/);
  assert.doesNotMatch(message, /replit/i);
});

test("adds the internal message ID to the Twilio status callback", () => {
  assert.equal(
    buildStatusCallbackUrl("https://curvelink.example/sms/status", 42),
    "https://curvelink.example/sms/status?messageId=42"
  );
});

test("maps Twilio delivery states to CurveLink states", () => {
  assert.equal(mapTwilioStatus("delivered"), "delivered");
  assert.equal(mapTwilioStatus("sent"), "sent");
  assert.equal(mapTwilioStatus("undelivered"), "failed");
  assert.equal(mapTwilioStatus("failed"), "failed");
  assert.equal(mapTwilioStatus("queued"), "pending");
});
