require('dotenv').config();
const { buildStatusCallbackUrl } = require('./migration-config');

const now = () => new Date().toISOString();

const SANDBOX_MODE =
  process.env.SMS_SANDBOX_MODE === 'true' ||
  process.env.NODE_ENV === 'development';
const TWILIO_CONFIGURED = !!(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER
);

let client = null;

if (TWILIO_CONFIGURED && !SANDBOX_MODE) {
  client = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  console.log(`[${now()}] Twilio client initialized`);
} else if (SANDBOX_MODE) {
  console.log(`[${now()}] SANDBOX MODE: SMS will be logged to console (NODE_ENV=development)`);
} else {
  console.warn(`[${now()}] Twilio credentials not configured. SMS features disabled.`);
}

async function sendSMS(to, body) {
  if (SANDBOX_MODE) {
    console.log(`[${now()}] [SANDBOX] SMS to ${to}: ${body}`);
    return { sid: 'SANDBOX_' + Date.now(), status: 'sandbox' };
  }

  if (!client) {
    console.warn(`[${now()}] Twilio not configured. Cannot send SMS.`);
    return { error: 'Twilio not configured', status: 'failed' };
  }

  try {
    const msg = await client.messages.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      body
    });
    console.log(`[${now()}] SMS sent to ${to}, SID: ${msg.sid}`);
    return { sid: msg.sid, status: 'sent' };
  } catch (err) {
    console.error(`[${now()}] SMS error (${to}): ${err.message}`);
    throw err;
  }
}

async function sendWelcomeSMS(phone) {
  const body = 'CurveLink: You are now subscribed to receive building updates. Reply STOP to cancel, HELP for help.';
  return sendSMS(phone, body);
}

async function broadcastSMS(phones, message, messageId) {
  const results = [];
  const statusCallback = buildStatusCallbackUrl(process.env.STATUS_CALLBACK_URL, messageId);

  for (let to of phones) {
    if (SANDBOX_MODE) {
      console.log(`[${now()}] [SANDBOX] Broadcast to ${to}: ${message}`);
      results.push({ to, sid: 'SANDBOX_' + Date.now(), status: 'sent' });
      continue;
    }

    if (!client) {
      console.warn(`[${now()}] Twilio not configured. Skipping ${to}`);
      results.push({ to, error: 'Twilio not configured', status: 'failed' });
      continue;
    }

    try {
      const msgOptions = {
        to,
        from: process.env.TWILIO_PHONE_NUMBER,
        body: message
      };

      if (statusCallback) {
        msgOptions.statusCallback = statusCallback;
      }

      const msg = await client.messages.create(msgOptions);
      console.log(`[${now()}] Sent to ${to}, SID: ${msg.sid}`);
      results.push({ to, sid: msg.sid, status: 'sent' });
    } catch (err) {
      console.error(`[${now()}] Failed to ${to}: ${err.message}`);

      await new Promise(r => setTimeout(r, 1000));
      try {
        const msgOptions = {
          to,
          from: process.env.TWILIO_PHONE_NUMBER,
          body: message
        };

        if (statusCallback) {
          msgOptions.statusCallback = statusCallback;
        }

        const retryMsg = await client.messages.create(msgOptions);
        console.log(`[${now()}] Retry successful: ${to}, SID: ${retryMsg.sid}`);
        results.push({ to, sid: retryMsg.sid, status: 'sent (retry)' });
      } catch (retryErr) {
        console.error(`[${now()}] Final failure for ${to}: ${retryErr.message}`);
        results.push({ to, error: retryErr.message, status: 'failed' });
      }
    }
  }

  return results;
}

async function verifyTwilioConnection() {
  if (SANDBOX_MODE) {
    console.log(`[${now()}] [SANDBOX] Twilio connection test skipped (development mode)`);
    return { success: true, mode: 'sandbox' };
  }

  if (!client) {
    console.warn(`[${now()}] Twilio credentials not configured`);
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    console.log(`[${now()}] Twilio connection verified: ${account.friendlyName} (${account.status})`);
    return { success: true, accountName: account.friendlyName, status: account.status };
  } catch (err) {
    console.error(`[${now()}] Twilio connection failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendSMS,
  sendWelcomeSMS,
  broadcastSMS,
  verifyTwilioConnection,
  SANDBOX_MODE,
  TWILIO_CONFIGURED
};

if (require.main === module) {
  console.log(`[${now()}] Testing Twilio connection...`);
  verifyTwilioConnection()
    .then(result => {
      console.log(`[${now()}] Connection test result:`, result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error(`[${now()}] Test error:`, err);
      process.exit(1);
    });
}
