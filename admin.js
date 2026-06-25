console.log("CurveLink Command Center loaded");

const API_BASE = '';

let pendingBroadcastMessage = null;
let pendingReportId = null;
let pendingAction = null; // 'broadcast' or 'dismiss'
let pendingDismissId = null;

// Toast notification system
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">&times;</button>
  `;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 5000);
}

// Loading state helper
function setButtonLoading(button, loading) {
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = 'Processing...';
    button.disabled = true;
    button.style.opacity = '0.7';
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    button.style.opacity = '1';
  }
}

function showSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    console.warn(`Section "${sectionId}" not found.`);
    return;
  }

  document.querySelectorAll("main section").forEach(sec => sec.classList.add("hidden"));
  section.classList.remove("hidden");

  if (sectionId === "dashboard") loadDashboardStats();
  if (sectionId === "subscribers") loadSubscribers();
  if (sectionId === "alerts") loadAlerts();
  if (sectionId === "inbox") loadReports();
}

function showModal(modalId) {
  document.getElementById(modalId).classList.remove("hidden");
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add("hidden");
  if (modalId === "passwordModal") {
    document.getElementById("adminPasswordInput").value = "";
    document.getElementById("passwordError").classList.add("hidden");
    pendingBroadcastMessage = null;
    pendingReportId = null;
    pendingAction = null;
    pendingDismissId = null;
    // Reset modal text to broadcast defaults
    document.getElementById("modalTitle").textContent = "Admin Authentication";
    document.getElementById("modalDesc").textContent = "Enter your admin password to authorize this broadcast.";
    document.getElementById("confirmBroadcastBtn").textContent = "Authorize & Send";
  }
  if (modalId === "newAlertModal") {
    document.getElementById("alertMessage").value = "";
    document.getElementById("charCount").textContent = "0";
  }
}

async function loadDashboardStats() {
  try {
    const [subsRes, reportsRes, alertsRes] = await Promise.all([
      fetch(`${API_BASE}/subscribers`),
      fetch(`${API_BASE}/reports`),
      fetch(`${API_BASE}/alerts`)
    ]);
    
    const subscribers = (await subsRes.json()).subscribers || [];
    const reports = (await reportsRes.json()).reports || [];
    const alerts = (await alertsRes.json()).messages || [];
    
    const pendingReports = reports.filter(r => r.status === "pending");
    
    document.getElementById("stat-subscribers").textContent = subscribers.length;
    document.getElementById("stat-pending").textContent = pendingReports.length;
    document.getElementById("stat-broadcasts").textContent = alerts.length;
    
    updateInboxBadge(pendingReports.length);
  } catch (err) {
    console.error("Failed to load dashboard stats:", err);
  }
}

function updateInboxBadge(count) {
  const badge = document.getElementById("inbox-badge");
  badge.textContent = count;
  badge.style.display = count > 0 ? "inline" : "none";
}

async function loadSubscribers() {
  try {
    const response = await fetch(`${API_BASE}/subscribers`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const subscribers = Array.isArray(data.subscribers) ? data.subscribers : [];
    renderSubscribersTable(subscribers);
  } catch (err) {
    console.error("Failed to load subscribers:", err);
    renderSubscribersTable([]);
  }
}

function renderSubscribersTable(subscribers) {
  const tbody = document.getElementById("subscriberList");
  tbody.innerHTML = "";

  if (subscribers.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" style="text-align: center; color: #52525b;">No subscribers found</td>`;
    tbody.appendChild(tr);
    return;
  }

  subscribers.forEach(sub => {
    const tr = document.createElement("tr");
    const status = sub.status === "active" ? "Active" : "Inactive";
    const statusClass = sub.status === "active" ? "color: #22c55e" : "color: #ef4444";
    const optInDate = sub.created_at ? new Date(sub.created_at).toLocaleDateString() : "N/A";
    tr.innerHTML = `
      <td>${maskPhone(sub.phone)}</td>
      <td>${optInDate}</td>
      <td style="${statusClass}; font-weight: 600">${status}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadAlerts() {
  try {
    const response = await fetch(`${API_BASE}/alerts`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];
    renderAlertsTable(messages);
  } catch (err) {
    console.error("Failed to load alerts:", err);
    renderAlertsTable([]);
  }
}

function renderAlertsTable(messages) {
  const tbody = document.getElementById("alertList");
  tbody.innerHTML = "";

  if (messages.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align: center; color: #52525b;">No broadcasts sent yet</td>`;
    tbody.appendChild(tr);
    return;
  }

  messages.forEach(msg => {
    const tr = document.createElement("tr");
    const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleString() : "N/A";
    const messagePreview = msg.body ? (msg.body.length > 50 ? msg.body.substring(0, 50) + "..." : msg.body) : "—";
    tr.innerHTML = `
      <td>${messagePreview}</td>
      <td>${timestamp}</td>
      <td style="color: #22c55e">${msg.total_recipients || 0}</td>
      <td style="color: #3b82f6">${msg.delivered || 0}</td>
      <td style="color: #ef4444">${msg.failed || 0}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadReports() {
  try {
    const response = await fetch(`${API_BASE}/reports`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const reports = Array.isArray(data.reports) ? data.reports : [];
    renderReportsList(reports);
    updateInboxBadge(reports.filter(r => r.status === "pending").length);
  } catch (err) {
    console.error("Failed to load reports:", err);
    renderReportsList([]);
  }
}

function renderReportsList(reports) {
  const container = document.getElementById("reportsList");
  container.innerHTML = "";

  const pendingReports = reports.filter(r => r.status === "pending");
  const handledReports = reports.filter(r => r.status !== "pending");

  // Render pending reports
  if (pendingReports.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No pending reports. Your community is all clear!";
    container.appendChild(empty);
  } else {
    pendingReports.forEach(report => {
      container.appendChild(buildReportCard(report, true));
    });
  }

  // Render handled report history
  if (handledReports.length > 0) {
    const historySection = document.createElement("div");
    historySection.className = "reports-history";

    const toggle = document.createElement("div");
    toggle.className = "history-toggle";
    toggle.innerHTML = `
      <span>Report History (${handledReports.length})</span>
      <svg id="historyChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
    `;

    const historyList = document.createElement("div");
    historyList.id = "historyList";
    historyList.className = "history-list hidden";

    handledReports.forEach(report => {
      historyList.appendChild(buildReportCard(report, false));
    });

    toggle.addEventListener("click", () => {
      historyList.classList.toggle("hidden");
      document.getElementById("historyChevron").style.transform =
        historyList.classList.contains("hidden") ? "rotate(0deg)" : "rotate(180deg)";
    });

    historySection.appendChild(toggle);
    historySection.appendChild(historyList);
    container.appendChild(historySection);
  }
}

function buildReportCard(report, isPending) {
  const card = document.createElement("div");
  card.className = "report-card" + (isPending ? "" : " report-card-handled");
  card.dataset.reportId = report.id;

  const time = report.created_at ? new Date(report.created_at).toLocaleString() : "N/A";
  const statusLabel = report.status === "approved"
    ? `<span class="report-status status-approved">Broadcasted</span>`
    : `<span class="report-status status-dismissed">Dismissed</span>`;

  card.innerHTML = `
    <div class="report-content">
      <div class="report-phone">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 15a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 4.11h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        ${maskPhone(report.phone)}
      </div>
      <div class="report-issue">${escapeHtml(report.issue)}</div>
      <div class="report-time">Reported: ${time}</div>
    </div>
    <div class="report-actions">
      ${isPending
        ? `<button class="btn-primary btn-approve">Approve & Send to All</button>
           <button class="btn-secondary btn-dismiss">Dismiss</button>`
        : statusLabel
      }
    </div>
  `;

  if (isPending) {
    card.querySelector('.btn-approve').addEventListener('click', () => handleApprove(report.id, report.issue));
    card.querySelector('.btn-dismiss').addEventListener('click', function() { handleDismiss(report.id); });
  }

  return card;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function maskPhone(phone) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    const offset = digits.length === 11 ? 1 : 0;
    const area = digits.slice(offset, offset + 3);
    const mid = digits.slice(offset + 3, offset + 6);
    return `+1 (${area}) ${mid}-XXXX`;
  }
  return phone.slice(0, -4) + 'XXXX';
}

function handleApprove(reportId, issue) {
  pendingAction = 'broadcast';
  pendingBroadcastMessage = `ALERT: ${issue}`;
  pendingReportId = reportId;
  document.getElementById("modalTitle").textContent = "Authorize Broadcast";
  document.getElementById("modalDesc").textContent = `This will send an alert to all residents: "${pendingBroadcastMessage}"`;
  document.getElementById("confirmBroadcastBtn").textContent = "Authorize & Send";
  showModal("passwordModal");
}

function handleDismiss(reportId) {
  pendingAction = 'dismiss';
  pendingDismissId = reportId;
  document.getElementById("modalTitle").textContent = "Confirm Dismiss";
  document.getElementById("modalDesc").textContent = "Enter your admin password to dismiss this report. No alert will be sent.";
  document.getElementById("confirmBroadcastBtn").textContent = "Confirm Dismiss";
  showModal("passwordModal");
}

async function confirmBroadcast() {
  const password = document.getElementById("adminPasswordInput").value;
  const errorEl = document.getElementById("passwordError");
  const confirmBtn = document.getElementById("confirmBroadcastBtn");

  if (!password) {
    errorEl.textContent = "Please enter your admin password.";
    errorEl.classList.remove("hidden");
    return;
  }

  setButtonLoading(confirmBtn, true);

  try {
    if (pendingAction === 'dismiss') {
      // Dismiss flow
      const response = await fetch(`${API_BASE}/reports/${pendingDismissId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password })
      });

      if (response.status === 401) {
        errorEl.textContent = "Invalid password. Please try again.";
        errorEl.classList.remove("hidden");
        setButtonLoading(confirmBtn, false);
        return;
      }
      if (!response.ok) throw new Error("Failed to dismiss report");

      closeModal("passwordModal");
      showToast("Report dismissed.", 'success');
    } else {
      // Broadcast flow
      const response = await fetch(`${API_BASE}/admin/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: pendingBroadcastMessage,
          reportId: pendingReportId,
          adminPassword: password
        })
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          errorEl.textContent = "Invalid password. Please try again.";
          errorEl.classList.remove("hidden");
          setButtonLoading(confirmBtn, false);
          return;
        }
        throw new Error(result.error || "Broadcast failed");
      }

      closeModal("passwordModal");
      showToast(`Broadcast sent to ${result.totalRecipients} resident(s)!`, 'success');
    }

    loadReports();
    loadDashboardStats();
  } catch (err) {
    console.error("Action failed:", err);
    errorEl.textContent = err.message || "Action failed. Please try again.";
    errorEl.classList.remove("hidden");
  } finally {
    setButtonLoading(confirmBtn, false);
  }
}

function showNewAlertModal() {
  showModal("newAlertModal");
}

async function sendAlert() {
  const message = document.getElementById("alertMessage").value.trim();

  if (!message) return alert("Message cannot be empty.");
  if (message.length > 250) return alert("Message too long. Keep it under 250 characters.");

  pendingAction = 'broadcast';
  pendingBroadcastMessage = message;
  pendingReportId = null;
  document.getElementById("modalTitle").textContent = "Authorize Broadcast";
  document.getElementById("modalDesc").textContent = "Enter your admin password to send this alert to all residents.";
  document.getElementById("confirmBroadcastBtn").textContent = "Authorize & Send";
  closeModal("newAlertModal");
  showModal("passwordModal");
}

function refreshSubscribers() {
  loadSubscribers();
}

function exportSubscribers() {
  alert("Export CSV feature coming soon.");
}

function saveApiKey() {
  const apiKeyInput = document.getElementById("apiKeyInput");
  const key = apiKeyInput.value.trim();
  if (!key) {
    alert("Please enter an API key.");
    return;
  }
  localStorage.setItem("curve_admin_api_key", key);
  alert("API key saved.");
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Command Center initialized");

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      showSection(btn.dataset.section);
    });
  });

  document.getElementById("tab-dashboard")?.classList.add("active");

  document.getElementById("refreshSubscribersBtn")?.addEventListener("click", refreshSubscribers);
  document.getElementById("exportSubscribersBtn")?.addEventListener("click", exportSubscribers);
  document.getElementById("refreshReportsBtn")?.addEventListener("click", loadReports);
  document.getElementById("newAlertBtn")?.addEventListener("click", showNewAlertModal);
  document.getElementById("saveApiKeyBtn")?.addEventListener("click", saveApiKey);

  const savedApiKey = localStorage.getItem("curve_admin_api_key");
  if (savedApiKey) {
    const apiKeyInput = document.getElementById("apiKeyInput");
    if (apiKeyInput) apiKeyInput.value = savedApiKey;
  }

  document.getElementById("sendAlertBtn")?.addEventListener("click", sendAlert);
  document.getElementById("cancelModalBtn")?.addEventListener("click", () => closeModal("newAlertModal"));
  document.getElementById("confirmBroadcastBtn")?.addEventListener("click", confirmBroadcast);
  document.getElementById("cancelPasswordBtn")?.addEventListener("click", () => closeModal("passwordModal"));

  const alertMessage = document.getElementById("alertMessage");
  const charCount = document.getElementById("charCount");
  if (alertMessage && charCount) {
    alertMessage.addEventListener("input", () => {
      charCount.textContent = alertMessage.value.length;
    });
  }

  const TEMPLATES = {
    emergency: 'ALERT: Please be advised of an urgent community notice: ',
    maintenance: 'Maintenance Notice: Scheduled maintenance will occur on [date/time]. ',
    community: 'Community Update: '
  };

  document.querySelectorAll('.btn-template').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = TEMPLATES[btn.dataset.template];
      if (template && alertMessage) {
        alertMessage.value = template;
        if (charCount) charCount.textContent = template.length;
        alertMessage.focus();
      }
    });
  });

  loadDashboardStats();
});
