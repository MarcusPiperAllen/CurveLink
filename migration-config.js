function normalizeBaseUrl(value) {
  if (!value) return null;

  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

function getCorsOrigins(env = process.env) {
  const explicitOrigins = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(",").map(normalizeBaseUrl).filter(Boolean)
    : [];

  if (explicitOrigins.length > 0) return explicitOrigins;

  return [
    normalizeBaseUrl(env.PUBLIC_BASE_URL),
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ].filter(Boolean);
}

function getHelpMessage(env = process.env) {
  const publicBaseUrl = normalizeBaseUrl(env.PUBLIC_BASE_URL);
  const websiteHelp = publicBaseUrl ? ` or visit ${publicBaseUrl}` : "";

  return `CurveLink Community Alerts: For help, email marcuspiperallen@gmail.com${websiteHelp}. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe.`;
}

function buildStatusCallbackUrl(statusCallbackUrl, messageId) {
  if (!statusCallbackUrl) return null;
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new Error("A positive messageId is required for the Twilio status callback");
  }

  const callbackUrl = new URL(statusCallbackUrl);
  callbackUrl.searchParams.set("messageId", String(messageId));
  return callbackUrl.toString();
}

function mapTwilioStatus(messageStatus) {
  if (messageStatus === "delivered") return "delivered";
  if (messageStatus === "sent") return "sent";
  if (["failed", "undelivered"].includes(messageStatus)) return "failed";
  return "pending";
}

module.exports = {
  normalizeBaseUrl,
  getCorsOrigins,
  getHelpMessage,
  buildStatusCallbackUrl,
  mapTwilioStatus,
};
