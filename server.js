// 1. Load environment variables
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const path = require("path");
const { MessagingResponse } = require("twilio").twiml;
const { sendSMS, broadcastSMS } = require("./twilio-tools");
const {
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
} = require("./db");

// 2. Initialize App & Middleware
const app = express();

// Trust first proxy hop — required for correct client IP behind Replit's proxy
app.set('trust proxy', 1);

app.use(helmet()); // Security headers
app.use(cors({
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')
        : [
            process.env.PUBLIC_BASE_URL || 'https://curve-link.replit.app',
            "http://localhost:5000",
            "http://127.0.0.1:5000"
          ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
    credentials: true
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

// Session secret guard — fail fast in production if secret is absent or insecure
const sessionSecret = process.env.SESSION_SECRET;
const KNOWN_INSECURE_FALLBACK = 'curvelink-fallback-secret';
if (!sessionSecret || sessionSecret === KNOWN_INSECURE_FALLBACK) {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: SESSION_SECRET is not set or uses the insecure default. Set SESSION_SECRET in Replit Secrets and restart.');
        process.exit(1);
    } else {
        console.warn('⚠️  SESSION_SECRET is missing or insecure. Using dev fallback — do NOT run this in production.');
    }
}

// Session middleware — uses SESSION_SECRET from Replit Secrets
app.use(session({
    secret: sessionSecret || 'curvelink-fallback-secret-dev-only',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS-only in production
        maxAge: 8 * 60 * 60 * 1000 // 8 hours
    }
}));

// Rate limiters
const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts. Try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const subscribeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many subscription attempts. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Middleware: protect all /admin routes
function requireAdminAuth(req, res, next) {
    if (req.session && req.session.adminAuthenticated) {
        return next();
    }
    res.redirect('/admin/login');
}

// Block direct access to admin.html before static middleware can serve it
app.use((req, res, next) => {
    if (req.path === '/admin.html') return res.redirect('/admin');
    next();
});

// Only these specific static asset files (JS/CSS used by the public pages)
// are safe to serve directly. This replaces express.static(__dirname), which
// previously served the ENTIRE project folder publicly (source files, notes,
// package.json, attached_assets, etc.). Do not add server-side files (db.js,
// twilio-tools.js, .env, .md files, etc.) to this list.
const PUBLIC_STATIC_FILES = new Set([
  "index.js",
  "report.js",
  "admin.js",
  "admin-login.js",
  "admin.css",
  "optin-screenshot.png",
]);
app.get("/:file", (req, res, next) => {
  if (PUBLIC_STATIC_FILES.has(req.params.file)) {
    return res.sendFile(path.join(__dirname, req.params.file));
  }
  next();
});

// 3. Verify Environment Variables
["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "BROADCAST_API_KEY", "ADMIN_PASSWORD", "PUBLIC_BASE_URL"].forEach(key => {
    console.log(`${key}:`, process.env[key] ? "✔️" : `❌ MISSING`);
});
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn("⚠️ Twilio credentials are missing. SMS features will not work until you add them.");
}
if (!process.env.ADMIN_PASSWORD) {
    console.warn("⚠️ ADMIN_PASSWORD is missing. Admin broadcast feature will not work.");
}

// 4. Phone normalization — ensures all numbers stored as E.164 (+12223334444)
function normalizePhone(raw) {
    if (!raw) return null;
    const digits = raw.toString().replace(/\D/g, ''); // strip everything except digits
    if (digits.length === 10) return '+1' + digits;       // 2103922392 → +12103922392
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits; // 12103922392 → +12103922392
    if (raw.startsWith('+') && digits.length >= 10) return '+' + digits;     // already E.164
    return '+1' + digits; // fallback
}

// Subscription Helpers
async function markUserSubscribed(phone) {
    const normalized = normalizePhone(phone);
    await addSubscriber(normalized, true); // SMS START is an explicit opt-in action
    console.log(`✅ User subscribed: ${normalized}`);
    return normalized;
}

async function markUserOptedOut(phone) {
    const normalized = normalizePhone(phone);
    await removeSubscriber(normalized);
    console.log(`✅ User opted out: ${normalized}`);
}

// 5. SMS Webhook (Handles Incoming Texts from Twilio)
app.post("/sms", async (req, res) => {
    const twiml = new MessagingResponse();
    const from = req.body.From;
    let body = req.body.Body?.trim().toUpperCase();

    try {
        if (!body) {
            twiml.message("Message cannot be empty. Reply START to subscribe, REPORT <...>, or STOP.");
        } else if (body === "START") {
            await markUserSubscribed(from);
            twiml.message("CurveLink Community Alerts: You are subscribed to receive property and community notices, maintenance updates, safety notices, resident announcements, and issue-report confirmations. Message frequency varies, typically 0-5 messages per month. Msg & data rates may apply. Reply STOP to unsubscribe or HELP for support.");
            console.log(`User ${from} subscribed.`);
        } else if (body.startsWith("REPORT ")) {
            const issue = req.body.Body?.trim().slice(7);
            if (!issue || issue.trim().length === 0) {
                twiml.message("CurveLink: Please include a description of your issue. Example: REPORT Water leak in hallway");
            } else {
                await addReport(from, issue);
                console.log(`📋 Report saved from ${from}: ${issue}`);
                twiml.message("CurveLink: Thank you! Your report has been received and our team will review it shortly.");
            }
        } else if (body === "STOP") {
            await markUserOptedOut(from);
            twiml.message("CurveLink Community Alerts: You have been unsubscribed and will receive no further messages. Reply START to subscribe again.");
            console.log(`User ${from} opted out.`);
        } else if (body === "HELP") {
            twiml.message("CurveLink Community Alerts: For help, email marcuspiperallen@gmail.com or visit https://curve-link.replit.app. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe.");
            console.log(`User ${from} requested HELP.`);
        } else {
            twiml.message("Reply START to subscribe, REPORT <...>, HELP, or STOP.");
        }
    } catch (error) {
        console.error("❌ Error processing SMS:", error);
        twiml.message("There was an error processing your request. Please try again.");
    }

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
});

// 6. Secure Broadcast Endpoint with API Key Middleware
function verifyAPIKey(req, res, next) {
    if (req.header("x-api-key") !== process.env.BROADCAST_API_KEY) {
        return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }
    next();
}

app.post("/broadcast", verifyAPIKey, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing "message" field in JSON body' });

    try {
        // Consent-filtered. Never send to the raw subscriber list.
        const subscribers = await getSendableSubscribers();
        const phoneList = subscribers.map(sub => sub.phone);

        if (!phoneList.length) {
            return res.status(200).json({ success: false, message: "No subscribers available." });
        }

        // Record message in DB
        const { lastInsertRowid: messageId } = await addMessage(message);

        // Link recipients
        for (const phone of phoneList) {
            await linkMessageToRecipient(messageId, phone, "pending");
        }

        // Send SMS
        const results = await broadcastSMS(phoneList, message);

        // Update recipient status in DB based on results
        for (const r of results) {
            let status = "pending";
            if (r.status === "sent" || r.status === "sent (retry)") status = "sent";
            else if (r.status === "failed") status = "failed";
            await updateRecipientStatus(messageId, r.to, status);
        }

        res.json({
            success: true,
            messageId,
            recipientCount: phoneList.length,
            totalRecipients: phoneList.length,
            sent: results.filter(r => r.status === "sent" || r.status === "sent (retry)").length,
            failed: results.filter(r => r.status === "failed").length,
            results
        });
    } catch (err) {
        console.error("❌ Broadcast failed:", err.message || err);
        res.status(500).json({ error: "Broadcast failed", details: err.message || err });
    }
});

// 7. Twilio Status Callback Webhook
app.post("/sms/status", (req, res) => {
    const { MessageSid, MessageStatus, To, ErrorCode } = req.body;

    console.log(`📬 Status update: ${MessageSid} → ${MessageStatus} (${To})`);

    // Map Twilio status to our status
    let dbStatus = "pending";
    if (MessageStatus === "delivered") dbStatus = "delivered";
    else if (MessageStatus === "sent") dbStatus = "sent";
    else if (["failed", "undelivered"].includes(MessageStatus)) dbStatus = "failed";

    if (ErrorCode) {
        console.error(`❌ Delivery error for ${To}: ${ErrorCode}`);
    }

    res.sendStatus(200);
});

// 8. Subscribers & Alerts Endpoints for Frontend — admin session required
app.get("/subscribers", requireAdminAuth, async (req, res) => {
    try {
        const subscribers = await getSubscribers();
        res.json({ subscribers });
    } catch (err) {
        console.error("❌ Error fetching subscribers:", err);
        res.status(500).json({ error: "Failed to fetch subscribers" });
    }
});

app.get("/alerts", requireAdminAuth, async (req, res) => {
    try {
        const messages = await getMessages();
        res.json({ messages });
    } catch (err) {
        console.error("❌ Error fetching alerts:", err);
        res.status(500).json({ error: "Failed to fetch alerts" });
    }
});

app.get("/reports", requireAdminAuth, async (req, res) => {
    try {
        const reports = await getReports();
        res.json({ reports });
    } catch (err) {
        console.error("❌ Error fetching reports:", err);
        res.status(500).json({ error: "Failed to fetch reports" });
    }
});

// 9. Public opt-in endpoint
app.post("/api/subscribe", subscribeLimiter, async (req, res) => {
    const { phone, consent } = req.body;

    // Validate phone
    if (!phone || typeof phone !== "string" || !phone.trim()) {
        return res.status(400).json({ success: false, message: "Phone number is required." });
    }

    // Consent must be explicitly true — a missing or false value is rejected
    if (consent !== true) {
        return res.status(400).json({ success: false, message: "You must provide explicit consent to receive SMS alerts." });
    }

    const normalizedPhone = normalizePhone(phone.trim());

    try {
        await addSubscriber(normalizedPhone, true);
        console.log(`✅ New subscriber via web form: ${normalizedPhone}`);

        // Send welcome SMS — identical to the START opt-in confirmation
        const welcomeMessage = "CurveLink Community Alerts: You are subscribed to receive property and community notices, maintenance updates, safety notices, resident announcements, and issue-report confirmations. Message frequency varies, typically 0-5 messages per month. Msg & data rates may apply. Reply STOP to unsubscribe or HELP for support.";
        await sendSMS(normalizedPhone, welcomeMessage);
        console.log(`📱 Welcome SMS sent to: ${normalizedPhone}`);

        res.json({ success: true, message: "You're now subscribed to CurveLink!" });
    } catch (err) {
        console.error("❌ Subscription error:", err);
        res.status(500).json({ success: false, message: "Failed to subscribe. Please try again." });
    }
});

// 10. Resident Report Endpoint (Verified Subscribers Only)
app.post("/api/report", async (req, res) => {
    const { phone, issue } = req.body;
    
    if (!phone || !issue) {
        return res.status(400).json({ success: false, message: "Phone number and issue description are required." });
    }
    
    const normalizedPhone = normalizePhone(phone.trim());
    const normalizedIssue = issue.trim();
    
    if (normalizedIssue.length < 5) {
        return res.status(400).json({ success: false, message: "Please provide more detail about the issue." });
    }
    
    try {
        // Verify the phone is a registered subscriber
        const isVerified = await isSubscriber(normalizedPhone);
        
        if (!isVerified) {
            return res.status(403).json({ 
                success: false, 
                message: "Number not recognized. Please sign up first." 
            });
        }
        
        // Add the report to the database
        await addReport(normalizedPhone, normalizedIssue);
        console.log(`📋 Web report submitted from ${normalizedPhone}: ${normalizedIssue}`);
        
        res.json({ success: true, message: "Report submitted successfully!" });
    } catch (err) {
        console.error("❌ Report submission error:", err);
        res.status(500).json({ success: false, message: "Failed to submit report. Please try again." });
    }
});

// 11. Password-Protected Admin Broadcast Endpoint
app.post("/admin/broadcast", async (req, res) => {
    const { message, reportId, adminPassword } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Missing "message" field' });
    }
    
    if (!adminPassword) {
        return res.status(400).json({ error: 'Missing admin password' });
    }
    
    if (adminPassword !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    try {
        // Consent-filtered. Never send to the raw subscriber list.
        const subscribers = await getSendableSubscribers();
        const phoneList = subscribers.map(sub => sub.phone);

        if (!phoneList.length) {
            return res.status(200).json({ success: false, message: "No subscribers available." });
        }

        const { lastInsertRowid: messageId } = await addMessage(message);

        for (const phone of phoneList) {
            await linkMessageToRecipient(messageId, phone, "pending");
        }

        const results = await broadcastSMS(phoneList, message);

        for (const r of results) {
            let status = "pending";
            if (r.status === "sent" || r.status === "sent (retry)") status = "sent";
            else if (r.status === "failed") status = "failed";
            await updateRecipientStatus(messageId, r.to, status);
        }

        if (reportId) {
            await updateReportStatus(reportId, "approved");
        }

        res.json({
            success: true,
            messageId,
            totalRecipients: phoneList.length,
            sent: results.filter(r => r.status === "sent" || r.status === "sent (retry)").length,
            failed: results.filter(r => r.status === "failed").length
        });
    } catch (err) {
        console.error("Admin broadcast failed:", err.message || err);
        res.status(500).json({ error: "Broadcast failed", details: err.message || err });
    }
});

// 11. Dismiss Report Endpoint (Password Protected)
app.post("/reports/:id/dismiss", async (req, res) => {
    const reportId = parseInt(req.params.id, 10);
    const { adminPassword } = req.body;
    
    if (isNaN(reportId)) {
        return res.status(400).json({ error: "Invalid report ID" });
    }
    
    if (!adminPassword || adminPassword !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Invalid admin password" });
    }
    
    try {
        await updateReportStatus(reportId, "dismissed");
        res.json({ success: true });
    } catch (err) {
        console.error("Failed to dismiss report:", err);
        res.status(500).json({ error: "Failed to dismiss report" });
    }
});

// Admin login — GET: show login page (redirect to /admin if already authenticated)
app.get("/admin/login", (req, res) => {
    if (req.session && req.session.adminAuthenticated) {
        return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, "admin-login.html"));
});

// Admin login — POST: verify password server-side only, never expose to frontend
app.post("/admin/login", adminLoginLimiter, (req, res) => {
    const { password } = req.body;
    if (password && password === process.env.ADMIN_PASSWORD) {
        req.session.adminAuthenticated = true;
        return res.redirect('/admin');
    }
    return res.redirect('/admin/login?error=1');
});

// Admin logout — destroy session and redirect to login
app.get("/admin/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// Admin dashboard — protected by requireAdminAuth middleware
app.get("/admin", requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

// Block direct file access to admin.html — route through protected /admin instead
app.get("/admin.html", (req, res) => res.redirect('/admin'));

// Serve landing page at root
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// Serve report page
app.get("/report", (_req, res) => res.sendFile(path.join(__dirname, "report.html")));

// Serve legal pages — explicit routes prevent 502 in autoscale deployment
app.get(["/terms", "/terms.html"], (_req, res) => res.sendFile(path.join(__dirname, "terms.html")));
app.get(["/privacy", "/privacy.html"], (_req, res) => res.sendFile(path.join(__dirname, "privacy.html")));

// 404 catch-all — must come after all specific routes
app.use((_req, res) => {
    res.status(404).sendFile(path.join(__dirname, "404.html"));
});

// 13. Global Error Handler
app.use((err, _req, res, _next) => {
    console.error("🚨 Server Error:", err);
    res.status(500).send("Internal Server Error");
});

// 14. Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server listening on port ${PORT}`));
