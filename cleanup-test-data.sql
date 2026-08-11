-- CurveLink production database cleanup
-- Written 2026-08-11. Run in Replit > Database > Production Database > My Data > SQL console.
-- Toggle "Enable Editing" ON first, or the writes will be rejected.
--
-- CONTEXT: CurveLink is pre-launch. No real resident has ever been enrolled.
-- Every row in every table is Marcus's own dev/test data. This is QA hygiene,
-- not a data-loss event.
--
-- GOAL: a clean demo. Empty broadcast history, no stale reports,
-- exactly one valid test subscriber (Marcus's own verified number).


-- ============================================================
-- STEP 1 — BEFORE. Run this alone first and keep the output.
-- ============================================================
SELECT 'subscribers' AS table, count(*) FROM subscribers
UNION ALL SELECT 'messages', count(*) FROM messages
UNION ALL SELECT 'message_recipients', count(*) FROM message_recipients
UNION ALL SELECT 'reports', count(*) FROM reports;

SELECT id, phone, status, consent_given FROM subscribers ORDER BY id;


-- ============================================================
-- STEP 2 — THE CLEANUP. Run this block as one unit.
-- It is wrapped in a transaction, so nothing is written until COMMIT.
-- If the row counts at the end look wrong, run ROLLBACK; instead.
-- ============================================================
BEGIN;

-- 2a. Broadcast history. Clearing this removes the stale "GABLES ALERT"
--     test message, which is unaffiliated third-party branding that Twilio
--     already made us scrub from the site. It should not be visible on a
--     Broadcast History screen in a management meeting.
--     Child rows first, foreign keys point this direction.
DELETE FROM message_recipients;
DELETE FROM messages;

-- 2b. Reports. Includes the "I see smoke in the hall" row still sitting at
--     status = 'pending'. That row renders an "Approve & Send to All" button
--     on the dashboard. Pre-approval that click failed harmlessly with error
--     30032. Now that toll-free verification is APPROVED, the same click
--     would really send. Removing it eliminates the accidental-send hazard.
DELETE FROM reports;

-- 2c. Subscribers. Keep ONLY the verified, consented, correctly formatted
--     number. That is Marcus's own phone, id 1, which passed the live
--     inbound START test on 2026-08-03.
--     This removes:
--       - the duplicate un-normalized copy of the same number (would fire
--         Twilio error 21211 and double-send)
--       - a test number with consent_given = FALSE
--       - the fake +10000000000 placeholder
DELETE FROM subscribers
WHERE NOT (
      status = 'active'
  AND consent_given = TRUE
  AND phone LIKE '+%'
  AND char_length(phone) BETWEEN 9 AND 16
);

-- 2d. Confirm before committing. Expect: subscribers 1, everything else 0.
SELECT 'subscribers' AS table, count(*) FROM subscribers
UNION ALL SELECT 'messages', count(*) FROM messages
UNION ALL SELECT 'message_recipients', count(*) FROM message_recipients
UNION ALL SELECT 'reports', count(*) FROM reports;

COMMIT;
-- ROLLBACK;   <-- use this instead of COMMIT if the counts above look wrong


-- ============================================================
-- STEP 3 — AFTER. Verify the one surviving subscriber.
-- Expect exactly one row: +12103922392, active, consent TRUE.
-- ============================================================
SELECT id, phone, status, consent_given FROM subscribers ORDER BY id;
