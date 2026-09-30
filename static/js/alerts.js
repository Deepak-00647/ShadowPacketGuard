let alertsPollTimer = null;
let alertsRequestInFlight = false;

async function loadAlerts() {
  if (alertsRequestInFlight) return;
  alertsRequestInFlight = true;

  try {
    const severity = document.getElementById("f-severity").value;
    const params = new URLSearchParams();
    if (severity && severity !== "ALL") params.set("severity", severity);

    const data = await nsFetch("/api/alerts?" + params.toString());
    const tbody = document.getElementById("alerts-table-body");
    tbody.innerHTML = data.alerts.map(a => `
      <tr>
        <td>${a.timestamp ? new Date(a.timestamp).toLocaleString() : ""}</td>
        <td>${a.alert_type}</td>
        <td><span class="badge badge-severity-${a.severity}">${a.severity}</span></td>
        <td>${a.source_ip || "N/A"}</td>
        <td>${a.description || ""}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="text-center text-secondary">No alerts found</td></tr>`;
  } catch (error) {
    console.error("Alert refresh failed:", error);
  } finally {
    alertsRequestInFlight = false;
    scheduleAlertsPoll();
  }
}

function scheduleAlertsPoll() {
  window.clearTimeout(alertsPollTimer);
  if (!document.hidden) {
    alertsPollTimer = window.setTimeout(loadAlerts, 5000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadAlerts();
  document.getElementById("f-severity").addEventListener("change", () => {
    window.clearTimeout(alertsPollTimer);
    loadAlerts();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(alertsPollTimer);
    } else {
      loadAlerts();
    }
  });
});
