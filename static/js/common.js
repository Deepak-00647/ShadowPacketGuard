async function nsFetch(url, options = {}) {
  options.headers = Object.assign({}, options.headers, {
    "X-CSRFToken": window.NETSCOPE_CSRF,
    "Content-Type": "application/json",
  });
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

(function initPageLoading() {
  const showLoader = () => {
    const loader = document.getElementById("ns-page-loader");
    if (!loader) return;
    loader.classList.add("is-visible");
    loader.setAttribute("aria-hidden", "false");
  };

  const hideLoader = () => {
    const loader = document.getElementById("ns-page-loader");
    if (!loader) return;
    loader.classList.remove("is-visible");
    loader.setAttribute("aria-hidden", "true");
  };

  document.addEventListener("DOMContentLoaded", () => {
    hideLoader();

    document.querySelectorAll("a[href]").forEach(link => {
      link.addEventListener("click", event => {
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          link.target === "_blank" ||
          link.hasAttribute("download")
        ) return;

        const url = new URL(link.href, window.location.href);
        const samePage = url.origin === window.location.origin &&
          url.pathname === window.location.pathname &&
          url.search === window.location.search;

        if (url.origin !== window.location.origin || samePage) return;
        showLoader();
      });
    });
  });

  window.addEventListener("pageshow", hideLoader);
})();


(function initLiveAlertNotifications() {
  const POLL_MS = 2000;
  let timer = null;
  let requestInFlight = false;
  let initialized = false;
  const seen = new Set();

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[ch]));
  }

  function severityClass(severity) {
    const value = String(severity || "").toLowerCase();
    if (value === "critical") return "danger";
    if (value === "high") return "warning";
    return "info";
  }

  function showAlertToast(alert) {
    const container = document.getElementById("ns-alert-notification-container");
    if (!container) return;

    const severity = escapeHtml(alert.severity || "Alert");
    const type = escapeHtml(alert.alert_type || "Security Alert");
    const source = escapeHtml(alert.source_ip || "Unknown source");
    const description = escapeHtml(alert.description || "A threat detection alert was raised.");
    const cls = severityClass(alert.severity);

    const toast = document.createElement("div");
    toast.className = `alert alert-${cls} shadow-lg ns-live-alert-toast`;
    toast.setAttribute("role", "alert");
    toast.innerHTML = `
      <div class="d-flex align-items-start gap-3">
        <i class="fa-solid fa-triangle-exclamation mt-1"></i>
        <div class="flex-grow-1">
          <div class="fw-bold">${severity} — ${type}</div>
          <div class="small">${description}</div>
          <div class="small opacity-75 mt-1">Source: ${source}</div>
        </div>
        <button type="button" class="btn-close" aria-label="Close"></button>
      </div>
    `;

    toast.querySelector(".btn-close").addEventListener("click", () => toast.remove());
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("ns-toast-hide");
      window.setTimeout(() => toast.remove(), 300);
    }, 7000);
  }

  async function requestPermission() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    try {
      await Notification.requestPermission();
    } catch (error) {
      console.debug("Notification permission request was not completed:", error);
    }
  }

  function showBrowserNotification(alert) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const notification = new Notification(
      `ShadowPacketGuard: ${alert.severity || "Alert"}`,
      {
        body: `${alert.alert_type || "Security alert"} — ${alert.source_ip || "Unknown source"}`,
        tag: `shadowpacketguard-alert-${alert.id}`,
        icon: "/static/favicon.ico",
      }
    );

    window.setTimeout(() => notification.close(), 8000);
  }

  async function pollAlerts() {
    if (requestInFlight || document.hidden) return;
    requestInFlight = true;

    try {
      const response = await fetch("/api/alerts", {
        headers: { "Accept": "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;

      const data = await response.json();
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];

      // Seed existing alerts silently. Only alerts created after the page
      // started are treated as new notifications.
      if (!initialized) {
        alerts.forEach(alert => seen.add(String(alert.id)));
        initialized = true;
        return;
      }

      for (const alert of alerts) {
        const id = String(alert.id);
        if (seen.has(id)) continue;
        seen.add(id);
        showAlertToast(alert);
        showBrowserNotification(alert);
      }

      // Keep memory bounded during long-running captures.
      if (seen.size > 1000) {
        const keep = new Set(alerts.map(alert => String(alert.id)));
        for (const id of seen) {
          if (!keep.has(id)) seen.delete(id);
        }
      }
    } catch (error) {
      console.debug("Live alert notification polling failed:", error);
    } finally {
      requestInFlight = false;
      window.clearTimeout(timer);
      if (!document.hidden) timer = window.setTimeout(pollAlerts, POLL_MS);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Browser notifications are optional; the in-app notification always works.
    const startButton = document.getElementById("btn-start");
    if (startButton) {
      startButton.addEventListener("click", requestPermission, { once: true });
    }

    pollAlerts();

    document.addEventListener("visibilitychange", () => {
      window.clearTimeout(timer);
      if (!document.hidden) pollAlerts();
    });
  });
})();
