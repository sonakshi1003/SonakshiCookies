import sqlite3
import datetime
import os
from flask import Flask, g, render_template, request, jsonify, session, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "cookies.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

DEFAULT_PRODUCTS = [
    ("Choco Chip Cookies", 99, "Classic & timeless, loaded with chocolate chips.", 20, "/static/images/choco_chip.jpeg"),
    ("Nutella Stuffed Cookies", 159, "A soft cookie with a gooey Nutella-filled centre.", 15, "/static/images/nutella_stuffed.jpeg"),
    ("S'more's Cookies", 159, "Chocolate, marshmallow and graham crumb in every bite.", 15, None),
]

DELIVERY_BASE_FEE = 30
DELIVERY_PER_KM = 12
DELIVERY_MAX_KM = 15
OWNER_PIN = "1234"

app = Flask(__name__)
app.secret_key = "sonakshis-cookies-dev-secret"  # fine for a local school project; change before any real deployment


# ---------------- Database ----------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_FILE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        stock INTEGER NOT NULL,
        image_path TEXT
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT NOT NULL,
        items TEXT NOT NULL,
        total REAL NOT NULL,
        order_date TEXT NOT NULL,
        delivery_mode TEXT,
        delivery_fee REAL,
        address TEXT,
        phone TEXT,
        status TEXT,
        source TEXT
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )""")
    conn.commit()

    c.execute("SELECT COUNT(*) FROM products")
    if c.fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO products (name, price, description, stock, image_path) VALUES (?,?,?,?,?)",
            DEFAULT_PRODUCTS,
        )
        conn.commit()
    conn.close()


def get_setting(key, default=""):
    row = get_db().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    get_db().execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    get_db().commit()


# ---------------- Business logic ----------------
def is_order_window_open():
    weekday = datetime.date.today().weekday()  # Mon=0 ... Sun=6
    return weekday in (6, 0, 1, 2)  # Sun, Mon, Tue, Wed


def calc_delivery_fee(distance_km):
    if distance_km <= 0:
        return 0
    return round(DELIVERY_BASE_FEE + DELIVERY_PER_KM * distance_km)


# ---------------- Search and sort algorithms ----------------
# maps the value sent by the shop page's sort menu to (field, descending)
SORT_OPTIONS = {
    "price_asc": ("price", False),
    "price_desc": ("price", True),
    "name_asc": ("name", False),
}


def linear_search(products, term):
    """Linear search: check every product in turn and keep those whose
    name contains the search text (case-insensitive). O(n)."""
    results = []
    term = term.lower()
    for product in products:
        if term in product["name"].lower():
            results.append(product)
    return results


def bubble_sort(items, key, descending=False):
    """Bubble sort: repeatedly compare neighbouring items and swap them if
    they are out of order. Each pass moves the largest remaining value to
    the end, so the next pass can stop one place earlier. O(n^2).
    Works on a copy so the original list is not changed."""
    arr = items[:]
    n = len(arr)
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            a, b = arr[j][key], arr[j + 1][key]
            if key == "name":
                a, b = a.lower(), b.lower()
            out_of_order = a < b if descending else a > b
            if out_of_order:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:  # a pass with no swaps means the list is sorted
            break
    return arr


def product_to_dict(row):
    d = dict(row)
    if d["stock"] <= 0:
        d["stock_label"] = "SOLD OUT"
    elif d["stock"] <= 3:
        d["stock_label"] = f"ONLY {d['stock']} LEFT"
    else:
        d["stock_label"] = f"{d['stock']} in stock"
    return d


def require_owner():
    return session.get("owner_authed") is True


# ---------------- Page routes ----------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/owner")
def owner_page():
    return render_template("owner.html")


# ---------------- Public API ----------------
@app.route("/api/status")
def api_status():
    return jsonify({
        "order_window_open": is_order_window_open(),
        "delivery_base_fee": DELIVERY_BASE_FEE,
        "delivery_per_km": DELIVERY_PER_KM,
        "delivery_max_km": DELIVERY_MAX_KM,
        "owner_contact": get_setting("owner_contact"),
        "qr_path": get_setting("qr_path"),
    })


@app.route("/api/products", methods=["GET"])
def api_get_products():
    rows = get_db().execute("SELECT * FROM products ORDER BY id").fetchall()
    products = [product_to_dict(r) for r in rows]

    term = request.args.get("q", "").strip()  # e.g. /api/products?q=choc
    if term:
        products = linear_search(products, term)

    sort_choice = request.args.get("sort", "")  # price_asc, price_desc, name_asc
    if sort_choice in SORT_OPTIONS:
        field, descending = SORT_OPTIONS[sort_choice]
        products = bubble_sort(products, field, descending)

    return jsonify(products)


@app.route("/api/orders", methods=["POST"])
def api_create_order():
    data = request.get_json(force=True)
    customer = (data.get("customer") or "").strip()
    items = data.get("items") or []  # [{id, qty}]
    delivery_mode = data.get("delivery_mode", "Pickup (free)")
    address = (data.get("address") or "").strip()
    phone = (data.get("phone") or "").strip()
    distance_km = float(data.get("distance_km") or 0)

    if not customer:
        return jsonify({"error": "Customer name is required."}), 400
    if not items:
        return jsonify({"error": "Cart is empty."}), 400
    if not is_order_window_open():
        return jsonify({"error": "Ordering is currently closed. Orders reopen Sunday."}), 400

    db = get_db()
    subtotal = 0
    order_items = []
    for item in items:
        row = db.execute("SELECT * FROM products WHERE id = ?", (item["id"],)).fetchone()
        if row is None:
            return jsonify({"error": "One of the items in your cart no longer exists."}), 400
        qty = int(item.get("qty", 0))
        if qty <= 0:
            return jsonify({"error": f"Invalid quantity for {row['name']}."}), 400
        if qty > row["stock"]:
            return jsonify({"error": f"Only {row['stock']} left of {row['name']}."}), 400
        subtotal += row["price"] * qty
        order_items.append({"id": row["id"], "name": row["name"], "price": row["price"], "qty": qty})

    delivery_fee = 0
    status = "Confirmed"
    if delivery_mode == "Delivery – estimate my fee":
        if not phone.strip():
            return jsonify({"error": "Phone number is required for delivery."}), 400
        delivery_fee = calc_delivery_fee(distance_km)
    elif delivery_mode == "Delivery – text me about charges":
        if not phone.strip():
            return jsonify({"error": "Phone number is required so we can text you."}), 400
        status = "Pending delivery quote"

    total = subtotal + delivery_fee
    items_str = "; ".join(f"{i['name']} x{i['qty']}" for i in order_items)
    now = datetime.datetime.now().isoformat(timespec="seconds")

    db.execute(
        """INSERT INTO orders (customer, items, total, order_date, delivery_mode, delivery_fee, address, phone, status, source)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (customer, items_str, total, now, delivery_mode, delivery_fee, address, phone, status, "Website"),
    )
    for i in order_items:
        db.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (i["qty"], i["id"]))
    db.commit()

    return jsonify({
        "message": "Order received!",
        "customer": customer,
        "items": order_items,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "total": total,
        "delivery_mode": delivery_mode,
        "status": status,
    }), 201


# ---------------- Owner auth ----------------
@app.route("/api/owner/login", methods=["POST"])
def api_owner_login():
    data = request.get_json(force=True)
    if data.get("pin") == OWNER_PIN:
        session["owner_authed"] = True
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Incorrect PIN."}), 401


@app.route("/api/owner/logout", methods=["POST"])
def api_owner_logout():
    session.pop("owner_authed", None)
    return jsonify({"ok": True})


@app.route("/api/owner/check")
def api_owner_check():
    return jsonify({"authed": require_owner()})


def owner_guard():
    if not require_owner():
        return jsonify({"error": "Not authorized."}), 401
    return None


# ---------------- Owner: orders ----------------
@app.route("/api/owner/orders", methods=["GET"])
def api_owner_orders():
    guard = owner_guard()
    if guard:
        return guard
    rows = get_db().execute("SELECT * FROM orders ORDER BY order_date DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/owner/orders/<int:order_id>", methods=["PUT"])
def api_owner_update_order(order_id):
    guard = owner_guard()
    if guard:
        return guard
    data = request.get_json(force=True)
    db = get_db()
    row = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Order not found."}), 404

    status = data.get("status", row["status"])
    if "delivery_fee" in data:
        new_fee = float(data["delivery_fee"])
        new_total = row["total"] - (row["delivery_fee"] or 0) + new_fee
        db.execute("UPDATE orders SET status=?, delivery_fee=?, total=? WHERE id=?",
                   (status, new_fee, new_total, order_id))
    else:
        db.execute("UPDATE orders SET status=? WHERE id=?", (status, order_id))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/owner/orders/<int:order_id>", methods=["DELETE"])
def api_owner_delete_order(order_id):
    guard = owner_guard()
    if guard:
        return guard
    get_db().execute("DELETE FROM orders WHERE id = ?", (order_id,))
    get_db().commit()
    return jsonify({"ok": True})


@app.route("/api/owner/orders/manual", methods=["POST"])
def api_owner_manual_order():
    guard = owner_guard()
    if guard:
        return guard
    data = request.get_json(force=True)
    customer = (data.get("customer") or "").strip()
    items = data.get("items") or []
    delivery_fee = float(data.get("delivery_fee") or 0)
    delivery_mode = data.get("delivery_mode", "Pickup (free)")
    address = (data.get("address") or "").strip()
    phone = (data.get("phone") or "").strip()

    if not customer or not items:
        return jsonify({"error": "Customer name and at least one item are required."}), 400

    db = get_db()
    subtotal = 0
    order_items = []
    for item in items:
        row = db.execute("SELECT * FROM products WHERE id = ?", (item["id"],)).fetchone()
        if row is None:
            continue
        qty = int(item.get("qty", 0))
        if qty <= 0:
            continue
        subtotal += row["price"] * qty
        order_items.append({"id": row["id"], "name": row["name"], "price": row["price"], "qty": qty})

    if not order_items:
        return jsonify({"error": "No valid items."}), 400

    total = subtotal + delivery_fee
    items_str = "; ".join(f"{i['name']} x{i['qty']}" for i in order_items)
    now = datetime.datetime.now().isoformat(timespec="seconds")

    db.execute(
        """INSERT INTO orders (customer, items, total, order_date, delivery_mode, delivery_fee, address, phone, status, source)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (customer, items_str, total, now, delivery_mode, delivery_fee, address, phone, "Confirmed", "Manual"),
    )
    for i in order_items:
        db.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (i["qty"], i["id"]))
    db.commit()
    return jsonify({"ok": True}), 201


# ---------------- Owner: products ----------------
@app.route("/api/owner/products", methods=["POST"])
def api_owner_add_product():
    guard = owner_guard()
    if guard:
        return guard
    name = request.form.get("name", "").strip()
    price = float(request.form.get("price", 0))
    description = request.form.get("description", "")
    stock = int(request.form.get("stock", 0))
    image_path = None

    if not name:
        return jsonify({"error": "Product name is required."}), 400

    file = request.files.get("image")
    if file and file.filename:
        filename = secure_filename(f"{name}_{file.filename}")
        file.save(os.path.join(UPLOAD_DIR, filename))
        image_path = f"/static/uploads/{filename}"

    db = get_db()
    db.execute(
        "INSERT INTO products (name, price, description, stock, image_path) VALUES (?,?,?,?,?)",
        (name, price, description, stock, image_path),
    )
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/owner/products/<int:product_id>", methods=["PUT"])
def api_owner_update_product(product_id):
    guard = owner_guard()
    if guard:
        return guard
    name = request.form.get("name", "").strip()
    price = float(request.form.get("price", 0))
    description = request.form.get("description", "")
    stock = int(request.form.get("stock", 0))

    db = get_db()
    row = db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Product not found."}), 404

    image_path = row["image_path"]
    file = request.files.get("image")
    if file and file.filename:
        filename = secure_filename(f"{product_id}_{file.filename}")
        file.save(os.path.join(UPLOAD_DIR, filename))
        image_path = f"/static/uploads/{filename}"

    db.execute(
        "UPDATE products SET name=?, price=?, description=?, stock=?, image_path=? WHERE id=?",
        (name, price, description, stock, image_path, product_id),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/owner/products/<int:product_id>", methods=["DELETE"])
def api_owner_delete_product(product_id):
    guard = owner_guard()
    if guard:
        return guard
    get_db().execute("DELETE FROM products WHERE id = ?", (product_id,))
    get_db().commit()
    return jsonify({"ok": True})


# ---------------- Owner: settings ----------------
@app.route("/api/owner/settings", methods=["GET"])
def api_owner_get_settings():
    guard = owner_guard()
    if guard:
        return guard
    return jsonify({
        "owner_contact": get_setting("owner_contact"),
        "qr_path": get_setting("qr_path"),
    })


@app.route("/api/owner/settings", methods=["POST"])
def api_owner_save_settings():
    guard = owner_guard()
    if guard:
        return guard
    contact = request.form.get("owner_contact")
    if contact is not None:
        set_setting("owner_contact", contact.strip())

    file = request.files.get("qr")
    if file and file.filename:
        filename = "qr_code_" + secure_filename(file.filename)
        file.save(os.path.join(UPLOAD_DIR, filename))
        set_setting("qr_path", f"/static/uploads/{filename}")

    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)