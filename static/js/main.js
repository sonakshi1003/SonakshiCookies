// ---------------- State ----------------
let PRODUCTS = [];
let STATUS = { order_window_open: true, delivery_base_fee: 30, delivery_per_km: 12, delivery_max_km: 15, owner_contact: "", qr_path: "" };
let CART = JSON.parse(localStorage.getItem("sc_cart") || "{}"); // { productId: qty }

const FAQ_ITEMS = [
  { q: "When can I place an order?", a: "Ordering opens every Sunday and closes Wednesday night. You can browse and build your cart anytime — checkout just needs to wait for the window to reopen if it's currently closed." },
  { q: "When will my cookies be ready?", a: "Orders placed during the Sun–Wed window are baked and prepared for pickup or delivery between Thursday and Sunday." },
  { q: "Can I pick up instead of getting delivery?", a: "Yes — pickup is free, just choose it at checkout." },
  { q: "How does delivery pricing work?", a: "You can get an instant estimate (₹30 base + ₹12/km), or leave your address and we'll text you the exact charge before confirming." },
  { q: "Do proceeds really go to animal shelters?", a: "Yes — 20% of each month's revenue is donated to local animal shelters at the end of the month. 🐾" },
];

// ---------------- Utilities ----------------
function saveCart() {
  localStorage.setItem("sc_cart", JSON.stringify(CART));
  updateCartBadge();
}

function updateCartBadge() {
  const count = Object.values(CART).reduce((a, b) => a + b, 0);
  document.getElementById("cartCount").textContent = count;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 2600);
}

// Search and sorting are handled by Python endpoints in app.py.
// JavaScript sends the search term and selected sort option to Flask.

// ---------------- Navigation ----------------
function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => (p.hidden = true));
  document.getElementById("page-" + name).hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "shop") renderShop();
  if (name === "cart") renderCart();
}

document.querySelectorAll(".nav-link[data-page]").forEach((btn) => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});
document.getElementById("logoBtn").addEventListener("click", () => showPage("home"));
document.getElementById("shopCta").addEventListener("click", () => {
  if (window.triggerCookieShopTransition) window.triggerCookieShopTransition();
  setTimeout(() => showPage("shop"), 500);
});
document.getElementById("careOrderBtn").addEventListener("click", () => showPage("shop"));

// ---------------- Fetch initial data ----------------
async function loadData() {
  try {
    const [productsRes, statusRes] = await Promise.all([
      fetch("/api/products"),
      fetch("/api/status"),
    ]);
    if (!productsRes.ok || !statusRes.ok) throw new Error("Could not load the shop data.");
    PRODUCTS = await productsRes.json();
    STATUS = await statusRes.json();
    updateCartBadge();
    renderFooterContact();
  } catch (error) {
    showToast("Could not load shop data. Please refresh the page.");
    console.error(error);
  }
}

function renderFooterContact() {
  const el = document.getElementById("footerNote");
  if (STATUS.owner_contact) {
    el.textContent = `Questions? Reach us at ${STATUS.owner_contact} 💬 · Made fresh in Bengaluru 🍪 · Sonakshi's Cookies`;
  }
}

// ---------------- FAQ ----------------
function renderFAQ() {
  const el = document.getElementById("faqSection");
  el.innerHTML = FAQ_ITEMS.map((item, i) => `
    <div class="faq-item" data-idx="${i}">
      <button class="faq-question">${item.q} <span class="faq-arrow">▾</span></button>
      <div class="faq-answer"><p>${item.a}</p></div>
    </div>
  `).join("");
  el.querySelectorAll(".faq-item").forEach((item) => {
    item.querySelector(".faq-question").addEventListener("click", () => {
      item.classList.toggle("open");
    });
  });
}

// ---------------- Shop page ----------------
function renderShop() {
  const notice = document.getElementById("orderWindowNotice");
  notice.innerHTML = STATUS.order_window_open
    ? ""
    : `<div class="notice-warning">Ordering is currently closed. Orders reopen Sunday. 🍪 You can still browse and build your cart.</div>`;

  applyShopFilters();
  document.getElementById("searchInput").oninput = applyShopFilters;
  document.getElementById("sortSelect").onchange = applyShopFilters;
}


let latestSearchRequest = 0;

async function applyShopFilters() {
  const term = document.getElementById("searchInput").value.trim();
  const sortVal = document.getElementById("sortSelect").value;
  const requestNumber = ++latestSearchRequest;

const params = new URLSearchParams({
    q: term,
    sort: sortVal
});

  try {
    const response = await fetch(`/api/products?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Product request failed: ${response.status}`);
    }

    const list = await response.json();

    // Ignore an older response if a newer search has started.
    if (requestNumber !== latestSearchRequest) return;

    renderProductGrid(list);
  } catch (error) {
    if (requestNumber === latestSearchRequest) {
      showToast("Could not search or sort products. Please try again.");
      console.error(error);
    }
  }
}


function renderProductGrid(list) {
  const grid = document.getElementById("productGrid");
  grid.innerHTML = list.map((p) => {
    const tagClass = p.stock <= 0 ? "out" : p.stock <= 3 ? "low" : "ok";
    const imgHtml = p.image_path
      ? `<img src="${p.image_path}" alt="${p.name}">`
      : `<div class="product-img-placeholder">🍪</div>`;
    return `
      <div class="product-card" data-id="${p.id}">
        <div class="product-img-wrap">
          ${imgHtml}
          <span class="stock-tag ${tagClass}">${p.stock_label}</span>
        </div>
        <div class="product-body">
          <div class="product-name">${p.name}</div>
          <div class="product-desc">${p.description || ""}</div>
          <div class="product-price">₹${p.price.toFixed(0)}</div>
          <div class="qty-row">
            <button class="qty-btn minus">−</button>
            <span class="qty-val">1</span>
            <button class="qty-btn plus">+</button>
          </div>
          <button class="add-cart-btn ${p.stock <= 0 ? "sold-out" : ""}" ${p.stock <= 0 ? "disabled" : ""}>
            ${p.stock <= 0 ? "Sold Out" : "Add to Cart"}
          </button>
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".product-card").forEach((card) => {
    const id = parseInt(card.dataset.id, 10);
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) return;
    const qtyEl = card.querySelector(".qty-val");
    let qty = 1;

    card.querySelector(".minus").addEventListener("click", () => {
      qty = Math.max(1, qty - 1);
      qtyEl.textContent = qty;
    });
    card.querySelector(".plus").addEventListener("click", () => {
      qty = Math.min(product.stock, qty + 1);
      qtyEl.textContent = qty;
    });
    const addBtn = card.querySelector(".add-cart-btn");
    if (addBtn && !addBtn.disabled) {
      addBtn.addEventListener("click", () => {
        CART[id] = (CART[id] || 0) + qty;
        saveCart();
        showToast(`Added ${qty} x ${product.name}`);
      });
    }

    // Subtle 3D tilt on hover (product-card interaction).
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(600px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px) scale(1.01)`;
    });
    card.addEventListener("mouseleave", () => { card.style.transform = ""; });
  });
}

// ---------------- Cart page ----------------
function renderCart() {
  const el = document.getElementById("cartContent");
  const entries = Object.entries(CART).filter(([id, qty]) => Number(qty) > 0);

  if (entries.length === 0) {
    el.innerHTML = `<div class="empty-cart"><p>Your cart is empty.</p><button class="btn-primary" id="browseBtn">Browse Cookies →</button></div>`;
    document.getElementById("browseBtn").addEventListener("click", () => showPage("shop"));
    return;
  }

  let subtotal = 0;
  const itemsHtml = entries.map(([id, qty]) => {
    const p = PRODUCTS.find((pr) => pr.id === parseInt(id, 10));
    if (!p) return "";
    const lineTotal = p.price * Number(qty);
    subtotal += lineTotal;
    return `
      <div class="cart-item" data-id="${id}">
        <div>
          <div class="name">${p.name}</div>
          <div class="muted-text">₹${p.price.toFixed(0)} x ${qty} = ₹${lineTotal.toFixed(0)}</div>
        </div>
        <button class="remove-btn">Remove</button>
      </div>`;
  }).join("");

  el.innerHTML = `
    ${itemsHtml}
    <div class="delivery-options" id="deliveryOptions">
      <label><input type="radio" name="mode" value="Pickup (free)" checked> Pickup (free)</label>
      <label><input type="radio" name="mode" value="Delivery – estimate my fee"> Delivery – estimate my fee</label>
      <label><input type="radio" name="mode" value="Delivery – text me about charges"> Delivery – text me about charges</label>
    </div>
    <div id="deliveryFields"></div>
    <div class="cart-summary" id="cartSummary"></div>
    <form class="checkout-form" id="checkoutForm">
      <input type="text" id="customerName" placeholder="Your name" required>
      <div id="qrBoxContainer"></div>
      <button type="submit" class="btn-primary" ${STATUS.order_window_open ? "" : "disabled"}>
        ${STATUS.order_window_open ? "Place Order" : "Ordering Closed — Reopens Sunday"}
      </button>
    </form>
  `;

  el.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".cart-item").dataset.id;
      delete CART[id];
      saveCart();
      renderCart();
    });
  });

  function updateSummary() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    let deliveryFee = 0;
    let deliveryLabel = "Free (pickup)";

    if (mode === "Delivery – estimate my fee") {
      const km = parseFloat(document.getElementById("distanceKm")?.value || 0);
      deliveryFee = km > 0 ? Math.round(STATUS.delivery_base_fee + STATUS.delivery_per_km * km) : 0;
      deliveryLabel = `₹${deliveryFee}`;
    } else if (mode === "Delivery – text me about charges") {
      deliveryLabel = "To be confirmed by text";
    }

    const total = subtotal + deliveryFee;
    document.getElementById("cartSummary").innerHTML = `
      <div class="line"><span>Subtotal</span><span>₹${subtotal.toFixed(0)}</span></div>
      <div class="line"><span>Delivery</span><span>${deliveryLabel}</span></div>
      <div class="line total-line"><span>Total</span><span>₹${total.toFixed(0)}${mode === "Delivery – text me about charges" ? " + delivery" : ""}</span></div>
    `;

    const qrContainer = document.getElementById("qrBoxContainer");
    if (STATUS.qr_path) {
      qrContainer.innerHTML = `<div class="qr-box"><p>Pay via QR code</p><img src="${STATUS.qr_path}" alt="Payment QR"></div>`;
    } else {
      qrContainer.innerHTML = "";
    }
  }

  function renderDeliveryFields() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const fieldsEl = document.getElementById("deliveryFields");
    if (mode === "Delivery – estimate my fee") {
      fieldsEl.innerHTML = `
        <input type="text" id="deliveryAddress" placeholder="Delivery address">
        <input type="text" id="deliveryPhone" placeholder="Phone number">
        <input type="number" id="distanceKm" placeholder="Approx. distance from bakery (km)" min="0" max="${STATUS.delivery_max_km}" step="0.5">
      `;
      document.getElementById("distanceKm").addEventListener("input", updateSummary);
    } else if (mode === "Delivery – text me about charges") {
      fieldsEl.innerHTML = `
        <p class="muted-text">We'll text you the exact delivery charge before confirming your order.${STATUS.owner_contact ? " You can also reach us at " + STATUS.owner_contact + "." : ""}</p>
        <input type="text" id="deliveryAddress" placeholder="Delivery address">
        <input type="text" id="deliveryPhone" placeholder="Phone number (required)">
      `;
    } else {
      fieldsEl.innerHTML = "";
    }
    updateSummary();
  }

  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", renderDeliveryFields));
  renderDeliveryFields();

  document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const customer = document.getElementById("customerName").value.trim();
    const address = document.getElementById("deliveryAddress")?.value || "";
    const phone = document.getElementById("deliveryPhone")?.value || "";
    const distanceKm = document.getElementById("distanceKm")?.value || 0;

    if (mode !== "Pickup (free)" && !phone.trim()) {
      showToast("Please enter a phone number for delivery.");
      return;
    }

    const items = entries.map(([id, qty]) => ({ id: parseInt(id, 10), qty: Number(qty) }));
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer, items, delivery_mode: mode, address, phone, distance_km: distanceKm }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Something went wrong.");
        return;
      }
      CART = {};
      saveCart();
      // Refresh product stock after a successful order.
      const productResponse = await fetch("/api/products");
      if (productResponse.ok) PRODUCTS = await productResponse.json();
      showConfirmation(data);
    } catch (error) {
      showToast("Could not submit the order. Please try again.");
      console.error(error);
    }
  });
}

function showConfirmation(order) {
  const el = document.getElementById("cartContent");
  const itemsHtml = order.items.map((i) => `<div class="line"><span>${i.name} x${i.qty}</span><span>₹${(i.price * i.qty).toFixed(0)}</span></div>`).join("");
  const statusNote = order.status === "Pending delivery quote"
    ? "<p>Delivery charge will be confirmed separately.</p>"
    : "";
  el.innerHTML = `
    <div class="confirmation-box">
      <h2>Order received! 🍪</h2>
      <p><b>${order.customer}</b></p>
      <div style="max-width:320px; margin:20px auto; text-align:left;">
        ${itemsHtml}
        <div class="line"><span>Delivery</span><span>${order.delivery_mode}</span></div>
        <div class="line total-line"><span>Total</span><span>₹${order.total.toFixed(0)}</span></div>
      </div>
      ${statusNote}
      <div class="confirmation-actions">
        <button class="btn-pill" id="backHomeBtn">Back to Home</button>
        <button class="btn-primary" id="continueShoppingBtn">Continue Shopping</button>
      </div>
    </div>
  `;
  document.getElementById("backHomeBtn").addEventListener("click", () => showPage("home"));
  document.getElementById("continueShoppingBtn").addEventListener("click", () => showPage("shop"));
}

// ---------------- Fade-in on scroll ----------------
function setupFadeIn() {
  const els = document.querySelectorAll(".fade-in");
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("visible");
    });
  }, { threshold: 0.15 });
  els.forEach((el) => obs.observe(el));
}

// ---------------- Init ----------------
(async function init() {
  await loadData();
  renderFAQ();
  setupFadeIn();
  updateCartBadge();
})();
