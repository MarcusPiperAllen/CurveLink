// db.js - PostgreSQL database layer for CurveLink
const { Pool } = require("pg");

// Create connection pool
// Uses DATABASE_URL for Render, or individual vars for local dev
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Run safe schema migrations
async function runMigrations() {
  await pool.query(`
    ALTER TABLE subscribers
    ADD COLUMN IF NOT EXISTS consent_given BOOLEAN NOT NULL DEFAULT false
  `);
  console.log("✅ Database migrations applied");
}

// Test connection on startup, then run migrations
pool.query("SELECT NOW()")
  .then(() => {
    console.log("✅ PostgreSQL connected");
    return runMigrations();
  })
  .catch(err => console.error("❌ PostgreSQL connection/migration error:", err.message));

// ============ SUBSCRIBER FUNCTIONS ============

async function addSubscriber(phone, consentGiven = false) {
  const query = `
    INSERT INTO subscribers (phone, status, consent_given)
    VALUES ($1, 'active', $2)
    ON CONFLICT (phone)
    DO UPDATE SET
      status = 'active',
      consent_given = subscribers.consent_given OR EXCLUDED.consent_given
    RETURNING *
  `;
  const result = await pool.query(query, [phone, consentGiven]);
  return result.rows[0];
}

// Admin view. Returns every active subscriber, including any missing consent,
// so the dashboard shows the true state of the list. Do NOT use this to send.
async function getSubscribers() {
  const query = "SELECT * FROM subscribers WHERE status = 'active' ORDER BY created_at DESC";
  const result = await pool.query(query);
  return result.rows;
}

// Broadcast-safe list. This is the ONLY function that should feed an SMS send.
// Three guards:
//   1. status = 'active'          — not opted out
//   2. consent_given = TRUE       — explicit opt-in on record (TCPA)
//   3. phone stored in E.164      — protects a whole broadcast from one malformed row,
//                                    which would otherwise throw Twilio error 21211
async function getSendableSubscribers() {
  const query = `
    SELECT * FROM subscribers
    WHERE status = 'active'
      AND consent_given = TRUE
      AND phone LIKE '+%'
      AND char_length(phone) BETWEEN 9 AND 16
    ORDER BY created_at DESC
  `;
  const result = await pool.query(query);
  return result.rows;
}

async function removeSubscriber(phone) {
  const query = "UPDATE subscribers SET status = 'inactive' WHERE phone = $1 RETURNING *";
  const result = await pool.query(query, [phone]);
  return result.rows[0];
}

async function isSubscriber(phone) {
  const query = "SELECT * FROM subscribers WHERE phone = $1 AND status = 'active'";
  const result = await pool.query(query, [phone]);
  return result.rows.length > 0;
}

// ============ MESSAGE FUNCTIONS ============

async function addMessage(body) {
  const query = "INSERT INTO messages (body) VALUES ($1) RETURNING id";
  const result = await pool.query(query, [body]);
  return { lastInsertRowid: result.rows[0].id };
}

async function linkMessageToRecipient(messageId, phone, status = 'pending') {
  const query = "INSERT INTO message_recipients (message_id, phone, status) VALUES ($1, $2, $3)";
  await pool.query(query, [messageId, phone, status]);
}

async function getMessages() {
  const query = `
    SELECT
      m.id,
      m.body,
      m.created_at,
      COUNT(mr.id) as total_recipients,
      SUM(CASE WHEN mr.status = 'sent' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN mr.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM messages m
    LEFT JOIN message_recipients mr ON m.id = mr.message_id
    GROUP BY m.id
    ORDER BY m.created_at DESC
  `;
  const result = await pool.query(query);
  return result.rows;
}

async function updateRecipientStatus(messageId, phone, status) {
  const query = "UPDATE message_recipients SET status = $1 WHERE message_id = $2 AND phone = $3";
  const result = await pool.query(query, [status, messageId, phone]);
  return result.rowCount;
}

// ============ REPORT FUNCTIONS ============

async function addReport(phone, issue) {
  const query = "INSERT INTO reports (phone, issue) VALUES ($1, $2) RETURNING *";
  const result = await pool.query(query, [phone, issue]);
  return result.rows[0];
}

async function getReports() {
  const query = "SELECT * FROM reports ORDER BY created_at DESC";
  const result = await pool.query(query);
  return result.rows;
}

async function updateReportStatus(reportId, status) {
  const query = "UPDATE reports SET status = $1 WHERE id = $2 RETURNING *";
  const result = await pool.query(query, [status, reportId]);
  return result.rows[0];
}

// ============ EXPORTS ============

module.exports = {
  pool,
  addSubscriber,
  getSubscribers,
  getSendableSubscribers,
  removeSubscriber,
  isSubscriber,
  addMessage,
  linkMessageToRecipient,
  getMessages,
  updateRecipientStatus,
  addReport,
  getReports,
  updateReportStatus
};
