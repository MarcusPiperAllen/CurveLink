// index.js - Public opt-in form handler

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("optInForm");
  const phoneInput = document.getElementById("phone");
  const consentCheckbox = document.getElementById("consent");
  const submitBtn = document.getElementById("submitBtn");
  const statusDiv = document.getElementById("optInStatus");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const phone = phoneInput.value.trim();

    if (!phone) {
      statusDiv.textContent = "Please enter a phone number.";
      statusDiv.className = 'message error';
      return;
    }

    if (!consentCheckbox.checked) {
      statusDiv.textContent = "You must agree to receive SMS alerts before subscribing.";
      statusDiv.className = 'message error';
      return;
    }

    // Disable button while submitting
    submitBtn.disabled = true;
    submitBtn.textContent = "Subscribing...";
    statusDiv.textContent = "";
    statusDiv.className = 'message';

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, consent: consentCheckbox.checked })
      });

      const result = await response.json();

      if (result.success) {
        statusDiv.textContent = "✅ You're subscribed! Watch for a confirmation text shortly.";
        statusDiv.className = 'message success';
        phoneInput.value = "";
        consentCheckbox.checked = false;
      } else {
        statusDiv.textContent = result.message || "Subscription failed.";
        statusDiv.className = 'message error';
      }
    } catch (err) {
      console.error("Subscription error:", err);
      statusDiv.textContent = "Network error. Please try again.";
      statusDiv.className = 'message error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Activate Alerts";
    }
  });
});
