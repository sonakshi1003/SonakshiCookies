let PRODUCTS = [];
let ORDERS = [];
let salesChart = null;

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------- Login ----------------
document.getElementById("loginBtn").addEventListener("click", login);
document.getElementById("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

async function login() {
  const pin = document.getElementById("pinInput").value;
  const res = await fetch("/api/owner/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }),
  });
  if (res.ok) {
    document.getElementById("loginBox").hidden = true;
    document.getElementById("dashboard").hidden = false;
    initDashboard();
  } else {
    document.getElementById("loginError").textContent = "Incorrect PIN.";
  }
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/owner/logout", { method: "POST" });
  location.reload();
});

(async function checkAuth() {
  const res = await fetch("/api/owner/check");
  const data = await res.json();
  if (data.authed) {
    document.getElementById("loginBox").hidden = true;
    document.getElementById("dashboard").hidden = false;
    initDashboard();
  }
})();

// ---------------- Tabs ----------------
document.querySelectorAll(".owner-tab[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".owner-tab[data-tab]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".owner-tab-panel").forEach((p) => (p.hidden = true));
    document.getElementById("tab-" + btn.dataset.tab).hidden = false;
  });
});

// ---------------- Init ----------------
async function initDashboard() {
  await Promise.all([loadProducts(), loadOrders(), loadSettings()]);
  renderOverview();
  renderOrdersTable();
  renderProductsAdmin();
  renderManualOrderItems();
}

async function loadProducts() {
  const res = await fetch("/api/products");
  PRODUCTS = await res.json();
}
async function loadOrders() {
  const res = await fetch("/api/owner/orders");
  ORDERS = await res.json();
}
async function loadSettings() {
  const res = await fetch("/api/owner/settings");
  const data = await res.json();
  document.getElementById("contactInput").value = data.owner_contact || "";
  const qrPreview = document.getElementById("qrPreview");
  qrPreview.innerHTML = data.qr_path ? `<img src="${data.qr_path}" style="max-width:160px;border-radius:10px;">` : "<p class='muted-text'>No QR uploaded yet.</p>";
}

// ---------------- Overview ----------------
function renderOverview() {
  const totalOrders = ORDERS.length;
  const totalRevenue = ORDERS.reduce((s, o) => s + o.total, 0);
  const totalProducts = PRODUCTS.length;
  const lowStock = PRODUCTS.filter((p) => p.stock <= 3).length;

  const now = new Date();
  const monthOrders = ORDERS.filter((o) => {
    const d = new Date(o.order_date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthRevenue = monthOrders.reduce((s, o) => s + o.total, 0);
  const donation = monthRevenue * 0.2;

  document.getElementById("metricsGrid").innerHTML = `
    <div class="metric-card"><div class="val">${totalOrders}</div><div class="lbl">Total Orders</div></div>
    <div class="metric-card"><div class="val">₹${totalRevenue.toFixed(0)}</div><div class="lbl">Total Revenue</div></div>
    <div class="metric-card"><div class="val">${totalProducts}</div><div class="lbl">Products</div></div>
    <div class="metric-card"><div class="val">${lowStock}</div><div class="lbl">Low Stock Alerts</div></div>
    <div class="metric-card"><div class="val">₹${monthRevenue.toFixed(0)}</div><div class="lbl">${now.toLocaleString("default", { month: "long" })} Revenue</div></div>
    <div class="metric-card"><div class="val">₹${donation.toFixed(0)}</div><div class="lbl">🐾 Shelter Donation (20%)</div></div>
  `;

  const byDate = {};
  ORDERS.forEach((o) => {
    const day = o.order_date.slice(0, 10);
    byDate[day] = (byDate[day] || 0) + o.total;
  });
  const labels = Object.keys(byDate).sort();
  const values = labels.map((d) => byDate[d]);

  const ctx = document.getElementById("salesChart");
  if (salesChart) salesChart.destroy();
  if (typeof Chart !== "undefined" && labels.length > 0) {
    salesChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ label: "Revenue (₹)", data: values, borderColor: "#DE838D", backgroundColor: "rgba(222,131,141,0.15)", tension: 0.3, fill: true }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  const recent = ORDERS.slice(0, 5);
  document.getElementById("recentOrdersTable").innerHTML = ordersTableHtml(recent, false);
}

// ---------------- Orders ----------------
function ordersTableHtml(orders, withActions) {
  const rows = orders.map((o) => `
    <tr>
      <td>#${o.id}</td>
      <td>${o.customer}</td>
      <td>${o.items}</td>
      <td>₹${o.total.toFixed(0)}</td>
      <td>${o.delivery_mode || "-"}</td>
      <td>${o.status}</td>
      <td>${o.source || "Website"}</td>
      <td>${new Date(o.order_date).toLocaleString()}</td>
      ${withActions ? `<td>
        ${o.status === "Pending delivery quote" ? `<input type="number" class="fee-input" data-id="${o.id}" placeholder="Fee ₹" style="width:70px;"> <button class="confirm-fee-btn" data-id="${o.id}">Confirm</button>` : ""}
        <button class="delete-order-btn" data-id="${o.id}">Delete</button>
      </td>` : ""}
    </tr>`).join("");
  return `<thead><tr><th>ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Mode</th><th>Status</th><th>Source</th><th>Date</th>${withActions ? "<th>Actions</th>" : ""}</tr></thead><tbody>${rows}</tbody>`;
}

function renderOrdersTable() {
  document.getElementById("ordersTable").innerHTML = ordersTableHtml(ORDERS, true);

  document.querySelectorAll(".delete-order-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/owner/orders/${btn.dataset.id}`, { method: "DELETE" });
      await loadOrders();
      renderOverview();
      renderOrdersTable();
      showToast("Order deleted.");
    });
  });
  document.querySelectorAll(".confirm-fee-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const fee = parseFloat(document.querySelector(`.fee-input[data-id="${id}"]`).value || 0);
      await fetch(`/api/owner/orders/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Confirmed", delivery_fee: fee }),
      });
      await loadOrders();
      renderOverview();
      renderOrdersTable();
      showToast("Delivery fee confirmed.");
    });
  });
}

function renderManualOrderItems() {
  const el = document.getElementById("moItems");
  el.innerHTML = PRODUCTS.map((p) => `
    <div class="mo-item-row">
      <span style="flex:1;">${p.name} (₹${p.price.toFixed(0)})</span>
      <input type="number" min="0" value="0" data-id="${p.id}" class="mo-qty">
    </div>
  `).join("");
}

document.getElementById("manualOrderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const customer = document.getElementById("moName").value.trim();
  const phone = document.getElementById("moPhone").value;
  const address = document.getElementById("moAddress").value;
  const mode = document.getElementById("moMode").value;
  const fee = parseFloat(document.getElementById("moFee").value || 0);
  const items = Array.from(document.querySelectorAll(".mo-qty"))
    .map((inp) => ({ id: parseInt(inp.dataset.id), qty: parseInt(inp.value || 0) }))
    .filter((i) => i.qty > 0);

  if (!customer || items.length === 0) { showToast("Customer name and at least one item required."); return; }

  const res = await fetch("/api/owner/orders/manual", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer, phone, address, delivery_mode: mode, delivery_fee: fee, items }),
  });
  if (res.ok) {
    showToast("Order logged.");
    e.target.reset();
    await Promise.all([loadOrders(), loadProducts()]);
    renderOverview(); renderOrdersTable(); renderProductsAdmin(); renderManualOrderItems();
  }
});

// ---------------- Products ----------------
function renderProductsAdmin() {
  const el = document.getElementById("productsAdmin");
  el.innerHTML = PRODUCTS.map((p) => `
    <div class="product-admin-row" data-id="${p.id}">
      ${p.image_path ? `<img src="${p.image_path}">` : `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;">🍪</div>`}
      <form class="owner-form edit-product-form" data-id="${p.id}" enctype="multipart/form-data" style="flex:1;">
        <input type="text" name="name" value="${p.name}" required>
        <input type="number" name="price" value="${p.price}" min="0" step="1" required>
        <input type="text" name="description" value="${p.description || ""}">
        <input type="number" name="stock" value="${p.stock}" min="0" step="1" required>
        <input type="file" name="image" accept="image/*">
        <div style="display:flex; gap:8px;">
          <button type="submit" class="btn-primary">Save</button>
          <button type="button" class="btn-pill delete-product-btn" data-id="${p.id}">Delete</button>
        </div>
      </form>
    </div>
  `).join("");

  el.querySelectorAll(".edit-product-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = form.dataset.id;
      const res = await fetch(`/api/owner/products/${id}`, { method: "PUT", body: new FormData(form) });
      if (res.ok) {
        showToast("Product updated.");
        await loadProducts();
        renderProductsAdmin(); renderManualOrderItems();
      }
    });
  });
  el.querySelectorAll(".delete-product-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/owner/products/${btn.dataset.id}`, { method: "DELETE" });
      await loadProducts();
      renderProductsAdmin(); renderManualOrderItems();
      showToast("Product deleted.");
    });
  });
}

document.getElementById("addProductForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("/api/owner/products", { method: "POST", body: new FormData(e.target) });
  if (res.ok) {
    showToast("Product added.");
    e.target.reset();
    await loadProducts();
    renderProductsAdmin(); renderManualOrderItems();
  } else {
    const data = await res.json();
    showToast(data.error || "Error adding product.");
  }
});

// ---------------- Settings ----------------
document.getElementById("qrForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("/api/owner/settings", { method: "POST", body: new FormData(e.target) });
  if (res.ok) { showToast("QR updated."); await loadSettings(); }
});

document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append("owner_contact", document.getElementById("contactInput").value);
  const res = await fetch("/api/owner/settings", { method: "POST", body: fd });
  if (res.ok) showToast("Contact number saved.");
});
