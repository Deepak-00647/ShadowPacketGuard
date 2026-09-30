let currentPage = 1;
let packetsPollTimer = null;
let packetsRequestInFlight = false;

function buildQuery() {
  const params = new URLSearchParams();
  const ip = document.getElementById("f-ip").value.trim();
  const port = document.getElementById("f-port").value.trim();
  const protocol = document.getElementById("f-protocol").value;
  const date = document.getElementById("f-date").value;
  const minSize = document.getElementById("f-minsize").value;
  if (ip) params.set("ip", ip);
  if (port) params.set("port", port);
  if (protocol && protocol !== "ALL") params.set("protocol", protocol);
  if (date) {
    params.set("date", date);
    params.set("tz_offset", String(new Date().getTimezoneOffset()));
  }
  if (minSize) params.set("min_size", minSize);
  params.set("page", currentPage);
  params.set("per_page", 50);
  return params.toString();
}

function formatPacketTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Invalid time";

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

async function loadPackets() {
  if (packetsRequestInFlight) return;
  packetsRequestInFlight = true;

  try {
    const data = await nsFetch("/api/packets?" + buildQuery());
    const tbody = document.getElementById("packet-table-body");
    tbody.innerHTML = data.packets.map(p => `
      <tr>
        <td title="${p.timestamp || ""}">${formatPacketTime(p.timestamp)}</td>
        <td>${p.protocol || ""}</td>
        <td>${p.src_ip || ""}</td>
        <td>${p.src_port ?? ""}</td>
        <td>${p.dst_ip || ""}</td>
        <td>${p.dst_port ?? ""}</td>
        <td>${p.packet_size ?? ""}</td>
        <td>${p.ttl ?? ""}</td>
        <td>${p.tcp_flags || ""}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="text-center text-secondary">No packets found</td></tr>`;

    renderPagination(data.total, data.per_page);
  } catch (error) {
    console.error("Packet refresh failed:", error);
  } finally {
    packetsRequestInFlight = false;
    schedulePacketsPoll();
  }
}

function schedulePacketsPoll() {
  window.clearTimeout(packetsPollTimer);
  if (!document.hidden) {
    packetsPollTimer = window.setTimeout(loadPackets, 5000);
  }
}

function renderPagination(total, perPage) {
  const totalPages = Math.max(Math.ceil(total / perPage), 1);
  const nav = document.getElementById("packet-pagination");
  let html = "";
  for (let p = 1; p <= Math.min(totalPages, 10); p++) {
    html += `<li class="page-item ${p === currentPage ? "active" : ""}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
  }
  nav.innerHTML = html;
  nav.querySelectorAll("a[data-page]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      currentPage = parseInt(a.dataset.page, 10);
      loadPackets();
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadPackets();

  document.getElementById("btn-search").addEventListener("click", () => {
    currentPage = 1;
    loadPackets();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(packetsPollTimer);
    } else {
      loadPackets();
    }
  });
});
