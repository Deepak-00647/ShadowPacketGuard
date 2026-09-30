let rateChart = null;
let protoChart = null;
let topIpChart = null;
let pollTimer = null;
let pollInFlight = false;

const SELECTED_INTERFACE_KEY = "shadowpacketguard.selectedInterface";

function getChartConstructor() {
  return typeof window.Chart === "function" ? window.Chart : null;
}

function ensureInterfaceSelected(value) {
  const select = document.getElementById("interface-select");
  if (!select || !value) return;

  const exists = Array.from(select.options).some(option => option.value === value);
  if (!exists) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.value = value;
}

function saveInterfaceSelection(value) {
  if (value) localStorage.setItem(SELECTED_INTERFACE_KEY, value);
}

function getSavedInterface() {
  return localStorage.getItem(SELECTED_INTERFACE_KEY) || "";
}

function restoreInterfaceSelection() {
  const saved = getSavedInterface();
  if (saved) ensureInterfaceSelected(saved);
}

function initCharts() {
  const ChartCtor = getChartConstructor();
  const rateCanvas = document.getElementById("chart-rate");
  const protoCanvas = document.getElementById("chart-protocol");
  const topIpCanvas = document.getElementById("chart-topips");

  if (!rateCanvas || !protoCanvas || !topIpCanvas) {
    console.error("Dashboard chart canvas elements are missing.");
    return false;
  }

  if (ChartCtor) {
    try {
      const gridColor = "rgba(255,255,255,0.05)";

      rateChart = new ChartCtor(rateCanvas, {
        type: "line",
        data: {
          labels: [],
          datasets: [{
            label: "Packets/sec",
            data: [],
            borderColor: "#00e5a0",
            backgroundColor: "rgba(0,229,160,0.15)",
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: gridColor } },
            y: { grid: { color: gridColor }, beginAtZero: true },
          },
        },
      });

      protoChart = new ChartCtor(protoCanvas, {
        type: "pie",
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [
              "#00e5a0", "#4d96ff", "#ffb703", "#ff4d6d",
              "#9d4edd", "#ff9f1c", "#06d6a0", "#118ab2"
            ],
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: { padding: { top: 4, bottom: 4 } },
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                boxWidth: 10,
                boxHeight: 10,
                padding: 8,
                font: { size: 10 },
              },
            },
          },
        },
      });

      topIpChart = new ChartCtor(topIpCanvas, {
        type: "bar",
        data: {
          labels: [],
          datasets: [{
            label: "Packets",
            data: [],
            backgroundColor: "#4d96ff",
            borderRadius: 4,
            borderSkipped: false,
            barThickness: 16,
            maxBarThickness: 18,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          indexAxis: "y",
          layout: {
            padding: { left: 2, right: 12, top: 4, bottom: 4 },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: items => items.length ? String(items[0].label || "N/A") : "",
                label: item => ` ${Number(item.raw || 0).toLocaleString()} packets`,
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { display: false },
              border: { display: false },
              ticks: { display: false },
            },
            y: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: "#d7e2ec",
                padding: 8,
                font: { size: 11 },
                autoSkip: false,
                maxTicksLimit: 7,
                callback: value => {
                  const label = String(topIpChart?.data?.labels?.[value] || "N/A");
                  return label.length > 15 ? `${label.slice(0, 14)}…` : label;
                },
              },
            },
          },
        },
        plugins: [{
          id: "topIpValues",
          afterDatasetsDraw(chart) {
            const { ctx, chartArea } = chart;
            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);
            if (!meta || !dataset || !meta.data.length) return;

            ctx.save();
            ctx.font = "600 11px Segoe UI";
            ctx.fillStyle = "#d7e2ec";
            ctx.textBaseline = "middle";
            ctx.textAlign = "right";

            meta.data.forEach((bar, index) => {
              const value = Number(dataset.data[index]) || 0;
              const x = Math.min(bar.x + 8, chartArea.right - 2);
              ctx.fillText(value.toLocaleString(), x, bar.y);
            });
            ctx.restore();
          },
        }],
      });

      return true;
    } catch (error) {
      console.error("Chart.js initialization failed; using canvas fallback:", error);
      rateChart = protoChart = topIpChart = null;
    }
  } else {
    console.warn("Chart.js unavailable; using canvas fallback charts.");
  }

  return true;
}

function canvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(Math.floor(rect.width), 280);
  const height = Math.max(Math.floor(rect.height), 220);
  const ratio = window.devicePixelRatio || 1;

  canvas.width = width * ratio;
  canvas.height = height * ratio;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawFallbackLine(canvas, points) {
  const { ctx, width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  for (let y = 25; y < height; y += 35) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (!points.length) return;

  const values = points.map(p => Number(p.count) || 0);
  const max = Math.max(...values, 1);
  const left = 8;
  const right = width - 8;
  const top = 12;
  const bottom = height - 15;

  ctx.strokeStyle = "#00e5a0";
  ctx.lineWidth = 2;
  ctx.beginPath();

  values.forEach((value, i) => {
    const x = values.length === 1
      ? (left + right) / 2
      : left + (i * (right - left) / (values.length - 1));
    const y = bottom - (value / max) * (bottom - top);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function drawFallbackPie(canvas, rows) {
  const { ctx, width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;

  const values = rows.map(r => Number(r.count) || 0);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = width / 2;
  const cy = Math.min(height * 0.38, 100);
  const radius = Math.min(width * 0.25, 72);
  const colors = [
    "#00e5a0", "#4d96ff", "#ffb703", "#ff4d6d",
    "#9d4edd", "#ff9f1c", "#06d6a0", "#118ab2"
  ];

  let angle = -Math.PI / 2;
  values.forEach((value, i) => {
    const next = angle + (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, next);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    angle = next;
  });

  ctx.font = "11px Segoe UI";
  rows.slice(0, 5).forEach((row, i) => {
    const y = height - 58 + i * 13;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(8, y - 8, 8, 8);
    ctx.fillStyle = "#d7e2ec";
    ctx.fillText(`${row.protocol}: ${row.count}`, 21, y);
  });
}

function drawFallbackBars(canvas, rows) {
  const { ctx, width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;

  const visible = rows.slice(0, 7);
  const labelWidth = Math.min(110, Math.max(82, Math.floor(width * 0.30)));
  const valueWidth = 45;
  const barLeft = labelWidth + 8;
  const barRight = width - valueWidth - 6;
  const barWidth = Math.max(barRight - barLeft, 40);
  const rowHeight = Math.min(30, (height - 10) / visible.length);
  const max = Math.max(...visible.map(r => Number(r.count) || 0), 1);

  ctx.font = "11px Segoe UI";
  ctx.textBaseline = "middle";

  visible.forEach((row, i) => {
    const centerY = 7 + i * rowHeight + rowHeight / 2;
    const count = Number(row.count) || 0;
    const barLength = (count / max) * barWidth;

    ctx.textAlign = "right";
    ctx.fillStyle = "#d7e2ec";
    ctx.fillText(String(row.ip || "N/A").slice(0, 15), labelWidth, centerY);

    ctx.textAlign = "left";
    ctx.fillStyle = "#4d96ff";
    ctx.fillRect(barLeft, centerY - 7, barLength, 14);

    ctx.textAlign = "right";
    ctx.fillStyle = "#d7e2ec";
    ctx.fillText(count.toLocaleString(), width - 2, centerY);
  });

  ctx.textBaseline = "alphabetic";
}

function updateCharts(data) {
  const series = Array.isArray(data.packet_rate_timeseries)
    ? data.packet_rate_timeseries.slice(-30)
    : [];
  const protocols = Array.isArray(data.protocol_distribution)
    ? data.protocol_distribution
    : [];
  const sourceIps = Array.isArray(data.top_source_ips)
    ? data.top_source_ips.slice(0, 7)
    : [];

  if (rateChart && protoChart && topIpChart) {
    rateChart.data.labels = series.map(p =>
      String(p.time || "").split(" ")[1] || p.time || ""
    );
    rateChart.data.datasets[0].data = series.map(p => Number(p.count) || 0);
    rateChart.update("none");

    protoChart.data.labels = protocols.map(p => p.protocol || "UNKNOWN");
    protoChart.data.datasets[0].data = protocols.map(p => Number(p.count) || 0);
    protoChart.update("none");

    topIpChart.data.labels = sourceIps.map(p => p.ip || "N/A");
    topIpChart.data.datasets[0].data = sourceIps.map(p => Number(p.count) || 0);
    topIpChart.update("none");
    return;
  }

  drawFallbackLine(document.getElementById("chart-rate"), series);
  drawFallbackPie(document.getElementById("chart-protocol"), protocols);
  drawFallbackBars(document.getElementById("chart-topips"), sourceIps);
}

function setStatusBadge(status) {
  const badge = document.getElementById("capture-status-badge");
  if (!badge) return;
  badge.textContent = String(status || "stopped").toUpperCase();
  badge.className = "ns-status-badge status-" + (status || "stopped");
}

function updateButtons(status) {
  const start = document.getElementById("btn-start");
  const pause = document.getElementById("btn-pause");
  const resume = document.getElementById("btn-resume");
  const stop = document.getElementById("btn-stop");

  if (!start || !pause || !resume || !stop) return;

  start.disabled = status !== "stopped";
  pause.disabled = status !== "running";
  resume.disabled = status !== "paused";
  stop.disabled = status === "stopped";
}

async function refreshStatus() {
  const data = await nsFetch("/api/capture/status");
  setStatusBadge(data.status);
  updateButtons(data.status);

  // While a capture is active, the server's interface is authoritative.
  // When stopped, the last manually selected interface is authoritative.
  // This prevents the previous capture's interface from overwriting a new
  // manual selection when navigating away and returning to the dashboard.
  if (data.status === "running" || data.status === "paused") {
    if (data.interface) {
      ensureInterfaceSelected(data.interface);
      saveInterfaceSelection(data.interface);
    }
  } else {
    restoreInterfaceSelection();
  }

  const meta = document.getElementById("capture-meta");
  if (meta) {
    meta.textContent = data.interface
      ? `Interface: ${data.interface} | Packets: ${Number(data.packet_count || 0).toLocaleString()}`
      : "";
  }

  const errBox = document.getElementById("capture-error");
  if (errBox) {
    if (data.error) {
      errBox.textContent = data.error;
      errBox.classList.remove("d-none");
    } else {
      errBox.classList.add("d-none");
    }
  }
}

async function refreshStats() {
  const data = await nsFetch("/api/stats");
  window.__shadowpacketguard_last_stats = data;
  const summary = data.summary || {};

  document.getElementById("stat-total").textContent =
    Number(summary.total_packets || 0).toLocaleString();
  document.getElementById("stat-pps").textContent =
    Number(summary.packets_per_second || 0).toFixed(2);
  document.getElementById("stat-avgsize").textContent =
    Number(summary.average_packet_size || 0).toFixed(2) + " B";
  document.getElementById("stat-bandwidth").textContent =
    humanBytes(Number(summary.bandwidth_bytes_per_second || 0)) + "/s";

  updateCharts(data);

  const portsBox = document.getElementById("top-ports-list");
  const ports = Array.isArray(data.top_ports) ? data.top_ports : [];
  portsBox.innerHTML = ports.map(p =>
    `<div class="mini-row"><span>Port ${p.port}</span><span>${Number(p.count || 0).toLocaleString()}</span></div>`
  ).join("") || '<div class="text-secondary">No data yet</div>';
}

async function refreshAlerts() {
  const data = await nsFetch("/api/alerts");
  const box = document.getElementById("recent-alerts");
  const recent = (Array.isArray(data.alerts) ? data.alerts : []).slice(0, 8);

  box.innerHTML = recent.map(a => `
    <div class="alert-row">
      <span><span class="badge badge-severity-${a.severity}">${a.severity}</span> ${a.alert_type} — ${a.source_ip || "N/A"}</span>
      <span class="text-secondary">${new Date(a.timestamp).toLocaleTimeString()}</span>
    </div>
  `).join("") || '<div class="text-secondary">No alerts yet</div>';
}

function humanBytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(2)} ${units[i]}`;
}

async function pollAll() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    await Promise.all([refreshStatus(), refreshStats(), refreshAlerts()]);
  } catch (e) {
    console.error("Dashboard refresh failed:", e);
    const errBox = document.getElementById("capture-error");
    if (errBox) {
      errBox.textContent = "Dashboard data refresh failed. Retrying automatically...";
      errBox.classList.remove("d-none");
    }
  } finally {
    pollInFlight = false;
    scheduleNextPoll();
  }
}

function scheduleNextPoll() {
  window.clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = window.setTimeout(pollAll, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  restoreInterfaceSelection();
  initCharts();
  pollAll();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(pollTimer);
      return;
    }
    pollAll();
  });

  window.addEventListener("resize", () => {
    if (!rateChart) {
      const last = window.__shadowpacketguard_last_stats;
      if (last) updateCharts(last);
    }
  });

  const interfaceSelect = document.getElementById("interface-select");
  interfaceSelect.addEventListener("change", () => {
    saveInterfaceSelection(interfaceSelect.value);
  });

  document.getElementById("btn-start").addEventListener("click", async () => {
    const iface = interfaceSelect.value;
    if (!iface) {
      alert("Select an interface first.");
      return;
    }

    saveInterfaceSelection(iface);
    try {
      await nsFetch("/api/capture/start", {
        method: "POST",
        body: JSON.stringify({ interface: iface }),
      });
      await pollAll();
    } catch (error) {
      console.error("Failed to start capture:", error);
    }
  });

  document.getElementById("btn-pause").addEventListener("click", async () => {
    try {
      await nsFetch("/api/capture/pause", { method: "POST" });
      await pollAll();
    } catch (error) {
      console.error("Failed to pause capture:", error);
    }
  });

  document.getElementById("btn-resume").addEventListener("click", async () => {
    try {
      await nsFetch("/api/capture/resume", { method: "POST" });
      await pollAll();
    } catch (error) {
      console.error("Failed to resume capture:", error);
    }
  });

  document.getElementById("btn-stop").addEventListener("click", async () => {
    try {
      await nsFetch("/api/capture/stop", { method: "POST" });
      await pollAll();
    } catch (error) {
      console.error("Failed to stop capture:", error);
    }
  });
});