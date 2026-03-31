"""
AgriBridge Backend API
======================
A complete Flask backend with SQLite database.
This is the server that powers all the buttons, forms,
USSD simulator, training modules, and marketplace.

HOW TO RUN:
  python3 app.py

Then open: http://localhost:5000
"""

from flask import Flask, request, jsonify, send_from_directory, g
import sqlite3
import hashlib
import json
import os
import re
from datetime import datetime, timedelta
import random
import string

# ─── APP SETUP ───────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder='static')
app.secret_key = 'agribridge-secret-2026'
DB_PATH = 'agribridge.db'

# Allow all origins (so the HTML file can call the API)
@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    return response

@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return jsonify({}), 200

# ─── DATABASE CONNECTION ──────────────────────────────────────────────────────
def get_db():
    """Get a database connection. Creates one if not open."""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row  # Makes rows behave like dicts
        db.execute("PRAGMA foreign_keys = ON")
    return db

@app.teardown_appcontext
def close_db(exception):
    """Close db connection when request ends."""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def query_db(sql, args=(), one=False):
    """Run a SELECT query and return results."""
    cur = get_db().execute(sql, args)
    rv = cur.fetchall()
    return (rv[0] if rv else None) if one else rv

def execute_db(sql, args=()):
    """Run INSERT/UPDATE/DELETE and commit."""
    db = get_db()
    cur = db.execute(sql, args)
    db.commit()
    return cur.lastrowid

def row_to_dict(row):
    """Convert a sqlite3.Row to a plain Python dict."""
    if row is None:
        return None
    return dict(zip(row.keys(), row))

def rows_to_list(rows):
    """Convert list of sqlite3.Row to list of dicts."""
    return [dict(zip(r.keys(), r)) for r in rows]

# ─── DATABASE SCHEMA (CREATE TABLES) ─────────────────────────────────────────
SCHEMA = """
-- ============================================================
--  AGRIBRIDGE DATABASE SCHEMA
--  All tables that power the platform
-- ============================================================

-- USERS table: stores every person who registers
-- Role can be: farmer, vendor, buyer, hotel, admin
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    phone       TEXT    NOT NULL UNIQUE,
    email       TEXT,
    password_hash TEXT,
    role        TEXT    NOT NULL CHECK(role IN ('farmer','vendor','buyer','hotel','admin')),
    district    TEXT,
    address     TEXT,
    national_id TEXT,
    trust_score INTEGER DEFAULT 60,
    ussd_code   TEXT    UNIQUE,
    is_verified INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now')),
    last_login  TEXT
);

-- FARMER_PROFILES: extra details only farmers have
CREATE TABLE IF NOT EXISTS farmer_profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
    farm_size_acres REAL,
    primary_crops   TEXT,        -- JSON array e.g. '["Tomatoes","Maize"]'
    monthly_output_kg INTEGER,
    gps_lat         REAL,
    gps_lng         REAL,
    momo_number     TEXT,        -- Mobile Money number
    bank_account    TEXT,
    main_challenge  TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- VENDOR_PROFILES: extra details for market vendors
CREATE TABLE IF NOT EXISTS vendor_profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
    business_name   TEXT,
    market_location TEXT,
    kcca_permit     TEXT,
    product_categories TEXT,     -- JSON array
    weekly_volume_kg   INTEGER,
    delivery_radius_km INTEGER,
    buyer_type      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- HOTEL_PROFILES: extra details for hotels and restaurants
CREATE TABLE IF NOT EXISTS hotel_profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
    hotel_type      TEXT,
    contact_person  TEXT,
    weekly_volume_kg INTEGER,
    delivery_time   TEXT,
    quality_grade   TEXT,
    special_needs   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- LISTINGS: products that farmers/vendors put up for sale
CREATE TABLE IF NOT EXISTS listings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id   INTEGER NOT NULL REFERENCES users(id),
    title       TEXT    NOT NULL,
    category    TEXT    NOT NULL CHECK(category IN ('fresh','seeds','fertiliser','tools','other')),
    price_ugx   INTEGER NOT NULL,
    unit        TEXT    NOT NULL,   -- e.g. 'per kg', 'per bunch'
    quantity_kg INTEGER,
    district    TEXT,
    description TEXT,
    emoji       TEXT    DEFAULT '🌿',
    badge       TEXT    DEFAULT 'Fresh',
    quality_grade TEXT  DEFAULT 'B',
    is_organic  INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    views       INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now')),
    harvest_date TEXT
);

-- ORDERS: when someone buys something
CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id      INTEGER NOT NULL REFERENCES users(id),
    seller_id     INTEGER NOT NULL REFERENCES users(id),
    listing_id    INTEGER REFERENCES listings(id),
    quantity      INTEGER NOT NULL DEFAULT 1,
    total_ugx     INTEGER NOT NULL,
    status        TEXT    DEFAULT 'pending'
                          CHECK(status IN ('pending','confirmed','in_transit','delivered','cancelled')),
    delivery_address TEXT,
    notes         TEXT,
    order_ref     TEXT    UNIQUE,
    created_at    TEXT    DEFAULT (datetime('now')),
    updated_at    TEXT    DEFAULT (datetime('now'))
);

-- CART_ITEMS: items in a user's basket before checkout
CREATE TABLE IF NOT EXISTS cart_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    listing_id  INTEGER NOT NULL REFERENCES listings(id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    added_at    TEXT    DEFAULT (datetime('now')),
    UNIQUE(user_id, listing_id)
);

-- PRICES: live price data for crops
CREATE TABLE IF NOT EXISTS prices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    crop_name   TEXT    NOT NULL,
    emoji       TEXT,
    price_ugx   INTEGER NOT NULL,
    unit        TEXT    DEFAULT 'per kg',
    district    TEXT    DEFAULT 'Kampala',
    change_pct  REAL    DEFAULT 0,
    trend       TEXT    DEFAULT 'stable' CHECK(trend IN ('up','down','stable')),
    source      TEXT    DEFAULT 'AgriBridge',
    recorded_at TEXT    DEFAULT (datetime('now'))
);

-- TRAINING_MODULES: the learning content
CREATE TABLE IF NOT EXISTS training_modules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    category    TEXT    NOT NULL CHECK(category IN ('crop','business','digital','postharvest','finance')),
    description TEXT,
    content     TEXT,            -- Full lesson content (text/HTML)
    video_url   TEXT,            -- YouTube embed URL
    duration_min INTEGER DEFAULT 20,
    level       TEXT    DEFAULT 'Beginner' CHECK(level IN ('Beginner','Intermediate','Advanced')),
    emoji       TEXT    DEFAULT '📚',
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now'))
);

-- USER_PROGRESS: tracks which modules a user has completed
CREATE TABLE IF NOT EXISTS user_progress (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    module_id       INTEGER NOT NULL REFERENCES training_modules(id),
    progress_pct    INTEGER DEFAULT 0,
    completed       INTEGER DEFAULT 0,
    started_at      TEXT    DEFAULT (datetime('now')),
    completed_at    TEXT,
    UNIQUE(user_id, module_id)
);

-- SMS_LOG: records every SMS sent through the platform
CREATE TABLE IF NOT EXISTS sms_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient   TEXT    NOT NULL,   -- phone number
    message     TEXT    NOT NULL,
    type        TEXT,               -- e.g. 'price_alert', 'order_confirm', 'welcome'
    status      TEXT    DEFAULT 'sent' CHECK(status IN ('sent','failed','pending')),
    sent_at     TEXT    DEFAULT (datetime('now'))
);

-- USSD_SESSIONS: tracks active USSD sessions
CREATE TABLE IF NOT EXISTS ussd_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL UNIQUE,
    phone       TEXT    NOT NULL,
    current_menu TEXT   DEFAULT 'home',
    session_data TEXT,              -- JSON for storing temp data
    created_at  TEXT    DEFAULT (datetime('now')),
    updated_at  TEXT    DEFAULT (datetime('now'))
);

-- MATCHES: records when vendors are matched to farmers
CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id   INTEGER REFERENCES users(id),
    farmer_id   INTEGER REFERENCES users(id),
    crop        TEXT,
    score_pct   INTEGER,
    status      TEXT    DEFAULT 'pending' CHECK(status IN ('pending','connected','completed','rejected')),
    created_at  TEXT    DEFAULT (datetime('now'))
);

-- REVIEWS: ratings left by buyers for sellers
CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reviewer_id INTEGER NOT NULL REFERENCES users(id),
    reviewed_id INTEGER NOT NULL REFERENCES users(id),
    order_id    INTEGER REFERENCES orders(id),
    rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
);

-- CONTACTS: messages sent via the contact form
CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    contact_info TEXT   NOT NULL,
    role        TEXT,
    message     TEXT    NOT NULL,
    is_read     INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
);

-- DISTRICTS: Uganda district data for the feasibility map
CREATE TABLE IF NOT EXISTS districts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    region      TEXT,
    farmer_count INTEGER DEFAULT 0,
    priority_score INTEGER DEFAULT 50,
    phase       INTEGER DEFAULT 3,
    lat         REAL,
    lng         REAL
);
"""

def init_db():
    """Create all tables and seed with initial data."""
    with app.app_context():
        db = get_db()
        # Create all tables
        db.executescript(SCHEMA)
        db.commit()
        print("✅ Database tables created.")
        seed_data()

def seed_data():
    """Add sample data so the app works immediately."""
    db = get_db()

    # Only seed if tables are empty
    count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count > 0:
        print("ℹ️  Database already has data, skipping seed.")
        return

    print("🌱 Seeding database with sample data...")

    # ── SEED USERS ──────────────────────────────────────────────────────────
    users_data = [
        ('Nakato Sarah', '+256772100001', 'nakato@agribridge.ug', hash_password('pass123'), 'farmer', 'Wakiso', None, 'CM9001001', 88, 'AB100001', 1),
        ('Ssemakula John', '+256772100002', 'john@nakasero.ug', hash_password('pass123'), 'vendor', 'Kampala', 'Nakasero Market Stall 42', 'CM9001002', 82, 'AB100002', 1),
        ('Grace Apio', '+256772100003', 'grace@gmail.com', hash_password('pass123'), 'buyer', 'Kampala', 'Ntinda, near Shell station', 'CM9001003', 75, 'AB100003', 1),
        ('Pearl Hotel Procurement', '+256772100004', 'supply@pearlhotel.ug', hash_password('pass123'), 'hotel', 'Kampala', 'Nakasero Hill, Kampala', 'CM9001004', 91, 'AB100004', 1),
        ('Muwanga Fred', '+256772100005', None, hash_password('pass123'), 'farmer', 'Mukono', None, 'CM9001005', 79, 'AB100005', 1),
        ('Aciro Grace', '+256772100006', None, hash_password('pass123'), 'farmer', 'Gulu', None, 'CM9001006', 77, 'AB100006', 1),
        ('Sserwadda David', '+256772100007', None, hash_password('pass123'), 'farmer', 'Masaka', None, 'CM9001007', 85, 'AB100007', 1),
        ('Admin User', '+256700000000', 'admin@agribridge.ug', hash_password('admin2026'), 'admin', 'Kampala', None, None, 99, 'ADMIN001', 1),
    ]
    db.executemany("""
        INSERT INTO users (name, phone, email, password_hash, role, district, address, national_id, trust_score, ussd_code, is_verified)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, users_data)

    # ── SEED FARMER PROFILES ─────────────────────────────────────────────────
    farmer_profiles = [
        (1, 3.5, '["Tomatoes","Cabbage"]', 400, 0.3429, 32.5880, '+256772100001', None, 'Prices crash at harvest, no direct buyers'),
        (5, 2.0, '["Tomatoes","Sweet Pepper"]', 150, 0.3564, 32.7531, '+256772100005', None, 'Hard to find reliable buyers'),
        (6, 4.0, '["Beans","Maize"]', 300, 2.7748, 32.2990, '+256772100006', None, 'Distance to Kampala market is too far'),
        (7, 5.0, '["Onions","Tomatoes"]', 500, -0.0512, 32.4478, '+256772100007', None, 'Middlemen take too much profit'),
    ]
    db.executemany("""
        INSERT INTO farmer_profiles (user_id, farm_size_acres, primary_crops, monthly_output_kg, gps_lat, gps_lng, momo_number, bank_account, main_challenge)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, farmer_profiles)

    # ── SEED VENDOR PROFILES ─────────────────────────────────────────────────
    db.execute("""
        INSERT INTO vendor_profiles (user_id, business_name, market_location, product_categories, weekly_volume_kg, delivery_radius_km, buyer_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (2, 'Ssemakula Fresh Produce', 'Nakasero Market, Stall 42', '["Vegetables","Fruits"]', 500, 15, 'Mixed'))

    # ── SEED HOTEL PROFILE ───────────────────────────────────────────────────
    db.execute("""
        INSERT INTO hotel_profiles (user_id, hotel_type, contact_person, weekly_volume_kg, delivery_time, quality_grade, special_needs)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (4, '5-Star Hotel', 'Head Chef Emmanuel', 500, '5am-7am (pre-kitchen)', 'Grade A (Premium)', 'Must be washed and sorted. Delivery receipt required.'))

    # ── SEED LISTINGS ────────────────────────────────────────────────────────
    listings_data = [
        (1, 'Fresh Tomatoes', 'fresh', 8000, 'per kg', 150, 'Wakiso', 'Freshly harvested Grade A tomatoes from Wakiso. Perfect for hotels and markets.', '🍅', 'Fresh', 'A', 0),
        (1, 'Fresh Cabbage', 'fresh', 3500, 'per kg', 80, 'Wakiso', 'Large tight cabbages. Harvested this week.', '🥬', 'Fresh', 'A', 0),
        (5, 'Sweet Pepper (Mixed Colors)', 'fresh', 12000, 'per kg', 60, 'Mukono', 'Mixed red and green sweet peppers, restaurant quality.', '🫑', 'Fresh', 'A', 0),
        (6, 'Dry Beans (Nambale)', 'fresh', 5500, 'per kg', 200, 'Gulu', 'Grade A dry beans, clean and sorted. Ready for immediate sale.', '🫘', 'Organic', 'A', 1),
        (6, 'Dry Maize', 'fresh', 1800, 'per kg', 400, 'Gulu', 'Sun-dried maize. Moisture below 14%. Good for storage.', '🌽', 'Fresh', 'B', 0),
        (7, 'White Onions', 'fresh', 7000, 'per kg', 300, 'Masaka', 'Large white onions, cured and ready. Excellent shelf life.', '🧅', 'Fresh', 'A', 0),
        (2, 'Matoke Bunch (Big)', 'fresh', 15000, 'per bunch', 50, 'Mukono', 'Large matoke bunches from Mukono. Farm-direct price.', '🍌', 'Organic', 'A', 1),
        (1, 'Hybrid Tomato Seeds (F1)', 'seeds', 45000, 'per 20g packet', 200, 'Wakiso', 'High-yield F1 hybrid. Disease resistant. 90-day maturity.', '🌱', 'Input', 'A', 0),
        (2, 'NPK 17-17-17 Fertiliser', 'fertiliser', 120000, 'per 50kg bag', 100, 'Kampala', 'Balanced NPK for all crops. UNBS certified.', '🧪', 'Input', 'A', 0),
        (2, 'Organic Compost (Treated)', 'fertiliser', 25000, 'per 25kg bag', 200, 'Kampala', 'Well-composted organic matter. Improves soil structure.', '🌿', 'Organic', 'A', 1),
    ]
    db.executemany("""
        INSERT INTO listings (seller_id, title, category, price_ugx, unit, quantity_kg, district, description, emoji, badge, quality_grade, is_organic)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, listings_data)

    # ── SEED PRICES ──────────────────────────────────────────────────────────
    prices_data = [
        ('Tomatoes', '🍅', 8200, 'per kg', 'Kampala', 5.2, 'up'),
        ('Matoke', '🍌', 15000, 'per bunch', 'Kampala', -3.1, 'down'),
        ('Maize (dry)', '🌽', 1850, 'per kg', 'Kampala', 0.5, 'stable'),
        ('Beans', '🫘', 5600, 'per kg', 'Kampala', 8.1, 'up'),
        ('Cabbage', '🥬', 3500, 'per kg', 'Kampala', -1.4, 'down'),
        ('Onions', '🧅', 7100, 'per kg', 'Kampala', 2.8, 'up'),
        ('Sweet Pepper', '🫑', 12000, 'per kg', 'Kampala', 1.5, 'up'),
        ('Cassava', '🌿', 1200, 'per kg', 'Kampala', 3.0, 'up'),
        ('Sweet Potato', '🍠', 2800, 'per kg', 'Kampala', 0.0, 'stable'),
        ('Avocado', '🥑', 4500, 'each', 'Kampala', 12.0, 'up'),
    ]
    db.executemany("""
        INSERT INTO prices (crop_name, emoji, price_ugx, unit, district, change_pct, trend)
        VALUES (?,?,?,?,?,?,?)
    """, prices_data)

    # ── SEED TRAINING MODULES ─────────────────────────────────────────────────
    modules_data = [
        # CROP MANAGEMENT
        ('Soil Preparation & Planting', 'crop',
         'Best practices for bed preparation, spacing and first fertiliser application.',
         '''<h3>Why Good Soil Preparation Matters</h3>
<p>The quality of your harvest depends more on how you prepare your soil than on any other single factor. Properly prepared soil allows roots to grow deep, water to drain well, and nutrients to reach plants easily.</p>

<h3>Step 1: Clear the Land (2 weeks before planting)</h3>
<ul>
<li>Remove all crop residues, weeds and stones</li>
<li>Burn or compost old plant material — never leave diseased plants</li>
<li>Mark out your beds: 1.2m wide, any length, 30cm paths between</li>
</ul>

<h3>Step 2: Deep Digging (Week 1)</h3>
<ul>
<li>Dig to 30cm depth using a fork or jembe</li>
<li>Break up large clods — the soil should be fine and crumbly</li>
<li>Remove all grass roots — even small pieces will re-grow</li>
</ul>

<h3>Step 3: Add Organic Matter</h3>
<ul>
<li>Mix in 2 wheelbarrows of compost per 10 square metres</li>
<li>If you have animal manure, add 1 wheelbarrow per 10sqm</li>
<li>Organic matter feeds soil bacteria which feed your plants</li>
</ul>

<h3>Step 4: Basal Fertiliser</h3>
<ul>
<li>Apply NPK 17-17-17 at 50g per square metre (1 soda bottlecap)</li>
<li>Mix into the top 15cm of soil — do NOT place next to seeds</li>
<li>Water lightly if soil is dry before planting</li>
</ul>

<h3>Spacing Guide (Uganda crops)</h3>
<table>
<tr><th>Crop</th><th>Row spacing</th><th>Plant spacing</th></tr>
<tr><td>Tomatoes</td><td>90cm</td><td>45cm</td></tr>
<tr><td>Cabbage</td><td>60cm</td><td>45cm</td></tr>
<tr><td>Maize</td><td>75cm</td><td>25cm</td></tr>
<tr><td>Beans</td><td>45cm</td><td>10cm</td></tr>
<tr><td>Onions</td><td>20cm</td><td>10cm</td></tr>
</table>

<h3>AgriBridge Tip</h3>
<p>After soil preparation, take a photo and upload it to the AI Crop Doctor. It can check your soil colour and texture and suggest what nutrients might be missing.</p>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         20, 'Beginner', '🌱'),

        ('Irrigation & Water Management', 'crop',
         'How to manage water stress, drip irrigation and rainfall harvesting.',
         '''<h3>Water: The Biggest Factor in Your Yield</h3>
<p>In Uganda, we have two main rainy seasons but dry spells still kill crops. Learning to manage water correctly can double your harvest.</p>

<h3>Signs Your Crops Need Water</h3>
<ul>
<li>Leaves curl inward or droop in the morning (not just afternoon)</li>
<li>Soil is dry 5cm below the surface when you push your finger in</li>
<li>Plant growth has slowed or stopped</li>
<li>Older leaves turn yellow from the bottom up</li>
</ul>

<h3>When to Water</h3>
<ul>
<li><strong>Best time: Early morning (6am-8am)</strong> — less evaporation, leaves dry during day (reduces disease)</li>
<li>Evening is second best — but wet leaves at night causes fungus</li>
<li>Never water in the midday sun — water evaporates before reaching roots</li>
</ul>

<h3>How Much to Water</h3>
<ul>
<li>Tomatoes: 2-3 litres per plant, 2-3 times per week in dry season</li>
<li>Cabbage: 1 litre per plant, every other day</li>
<li>Maize: Water deeply once per week (enough to reach 30cm depth)</li>
<li>Beans: Water every 3-4 days. Overwatering causes root rot.</li>
</ul>

<h3>Simple Drip Irrigation (low cost)</h3>
<p>You can make a cheap drip system with a 20-litre jerrycan:</p>
<ol>
<li>Make small holes (2mm) in the bottom of the jerrycan</li>
<li>Place the jerrycan between every 2 plants</li>
<li>Fill once per day in dry season — water drips slowly to roots</li>
<li>This uses 70% less water than watering by hand</li>
</ol>

<h3>Mulching to Save Water</h3>
<p>Cover the soil around your plants with dry grass or banana leaves (5-10cm thick). This keeps soil moist for 2x longer and also prevents weeds.</p>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         25, 'Intermediate', '🌧️'),

        ('Pest Identification & Control', 'crop',
         "Identifying Uganda's top 20 pests and organic/chemical control methods.",
         '''<h3>Uganda Top 5 Crop Pests You Must Know</h3>

<h3>1. Aphids (Kibbo)</h3>
<p>Tiny green/black insects in clusters under leaves. They suck sap and spread viruses.</p>
<p><strong>Organic control:</strong> Spray with diluted soap water (5 tablespoons dish soap + 1 litre water). Do this 3 days in a row.</p>
<p><strong>Chemical control:</strong> Imidacloprid (Confidor) - follow label instructions.</p>

<h3>2. Armyworm (Nsenene wa Kasuku)</h3>
<p>Caterpillars that eat maize leaves and stems at night. Causes big holes in leaves.</p>
<p><strong>Organic control:</strong> Pick caterpillars by hand in the evening. Spray neem oil solution.</p>
<p><strong>Chemical control:</strong> Emamectin Benzoate (Escort) spray.</p>

<h3>3. Whitefly</h3>
<p>Tiny white flies under tomato leaves. Spread tomato yellow leaf curl virus.</p>
<p><strong>Control:</strong> Yellow sticky traps. Spray insecticidal soap. Remove and burn heavily affected leaves.</p>

<h3>4. Thrips</h3>
<p>Tiny insects that damage onion leaves, causing silvery streaks.</p>
<p><strong>Control:</strong> Spinosad spray. Remove damaged outer leaves. Avoid overhead irrigation.</p>

<h3>5. Root Knot Nematodes</h3>
<p>Microscopic worms in soil that create lumps (galls) on roots. Plants look stunted and yellow.</p>
<p><strong>Control:</strong> Rotate crops. Add organic matter. Solarise soil (cover with clear plastic for 4 weeks in dry season).</p>

<h3>How to Use the AgriBridge AI Crop Doctor</h3>
<ol>
<li>Take a clear photo of the affected leaf, stem or fruit</li>
<li>Open the AI Doctor section on AgriBridge</li>
<li>Upload the photo and describe what you see</li>
<li>Get an instant diagnosis with specific Uganda products to use</li>
</ol>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         35, 'Intermediate', '🐛'),

        ('Organic Farming Certification', 'crop',
         'Steps to achieve organic certification and access premium markets.',
         '''<h3>Why Go Organic?</h3>
<p>Organic certified produce sells for 30-60% more than conventional. Hotels and export markets increasingly require organic certification. AgriBridge connects you with these premium buyers.</p>

<h3>Uganda Organic Certification Bodies</h3>
<ul>
<li><strong>NOGAMU</strong> (National Organic Agricultural Movement of Uganda) - most common</li>
<li><strong>OOAB</strong> - Uganda Organic Certification Association</li>
<li><strong>EU Organic</strong> - for export markets</li>
</ul>

<h3>Requirements for Organic Certification</h3>
<ol>
<li>Stop using synthetic pesticides and fertilisers for at least 3 years (conversion period)</li>
<li>Keep detailed farm records: what you planted, what you used, what you harvested</li>
<li>Have a clear boundary between your organic and non-organic land</li>
<li>Use only approved inputs (compost, neem, ash, soap)</li>
<li>Annual farm inspection by a certification officer</li>
</ol>

<h3>How AgriBridge Helps</h3>
<ul>
<li>We can connect you with a NOGAMU certification officer</li>
<li>Your AgriBridge profile tracks your farm history for you</li>
<li>Premium buyers on the platform filter for organic produce</li>
<li>Once certified, your listings get an "Organic Certified" badge</li>
</ul>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         45, 'Advanced', '🌿'),

        # BUSINESS MODULES
        ('Understanding Market Prices', 'business',
         'How to read AgriBridge price charts and when to sell vs. store.',
         '''<h3>Why Prices Change So Much in Uganda</h3>
<p>Farmers face extreme price swings because everyone plants at the same time, harvests at the same time, and all rush to sell at the same time. This creates a "glut" - too much supply, very low prices.</p>

<h3>The Price Cycle for Tomatoes</h3>
<p>Here is what typically happens each year:</p>
<ul>
<li><strong>January-February (dry season):</strong> Few tomatoes available → price UGX 8,000-12,000/kg</li>
<li><strong>March-April (planting season):</strong> Prices start falling as harvest approaches</li>
<li><strong>May-June (main harvest):</strong> Price crashes to UGX 1,500-3,000/kg</li>
<li><strong>July-August (short dry):</strong> Prices recover to UGX 6,000-8,000/kg</li>
</ul>

<h3>How to Use the AgriBridge Price Chart</h3>
<ol>
<li>Open the Prices section on AgriBridge</li>
<li>Select your crop from the list</li>
<li>The blue line shows AgriBridge stable prices (from forward contracts)</li>
<li>The red dotted line shows the volatile open market price</li>
<li>The gap between the lines = money you lose by selling on open market</li>
</ol>

<h3>When to Sell</h3>
<ul>
<li><strong>Best strategy:</strong> Lock in a forward contract price 4-6 weeks before harvest</li>
<li>If prices are rising, wait a few weeks if you have storage</li>
<li>If the AI predicts a glut, sell immediately or use flash sales</li>
<li>Never sell all at once — spread your sales over 2-3 weeks</li>
</ul>

<h3>Simple Price Record Keeping</h3>
<p>In your phone notes or a notebook, record every week: crop name, quantity sold, price received, buyer name. After 3 months you will see patterns that help you decide when to sell.</p>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         15, 'Beginner', '💰'),

        ('Record Keeping for Farmers', 'business',
         'Simple bookkeeping: income, expenses, and profit tracking on mobile.',
         '''<h3>Why Records Matter</h3>
<p>Most farmers do not know if they are making a profit or loss because they do not keep records. With simple records, you can: know your real profit, apply for a loan, plan better for next season, and prove your income to buyers.</p>

<h3>The Three Records Every Farmer Needs</h3>

<h3>Record 1: Input Expenses</h3>
<p>Write down everything you spend on the farm:</p>
<ul>
<li>Seeds purchased: date, quantity, cost</li>
<li>Fertilisers: date, type, quantity, cost</li>
<li>Pesticides: date, product, cost</li>
<li>Labour hired: date, number of workers, amount paid</li>
<li>Transport to market: cost per trip</li>
</ul>

<h3>Record 2: Income</h3>
<p>Write down every sale:</p>
<ul>
<li>Date of sale</li>
<li>Crop name and quantity (kg or bags)</li>
<li>Price per unit</li>
<li>Total received</li>
<li>Buyer name</li>
</ul>

<h3>Record 3: Calculate Profit</h3>
<p>At end of season: Total Income - Total Expenses = Profit (or Loss)</p>

<h3>Using Your Phone for Records</h3>
<ul>
<li>Use your phone Notes app or WhatsApp to yourself</li>
<li>AgriBridge automatically records all transactions made through the platform</li>
<li>Download your transaction history from your profile page</li>
</ul>

<h3>Example Calculation (1 acre of tomatoes)</h3>
<table>
<tr><th>Item</th><th>Amount (UGX)</th></tr>
<tr><td>Seeds</td><td>45,000</td></tr>
<tr><td>Fertiliser (2 bags NPK)</td><td>240,000</td></tr>
<tr><td>Pesticides</td><td>80,000</td></tr>
<tr><td>Labour (planting + weeding)</td><td>200,000</td></tr>
<tr><td>Transport (5 trips)</td><td>50,000</td></tr>
<tr><td><strong>Total Cost</strong></td><td><strong>615,000</strong></td></tr>
<tr><td>Harvest: 800kg × UGX 7,500</td><td>6,000,000</td></tr>
<tr><td><strong>PROFIT</strong></td><td><strong>5,385,000</strong></td></tr>
</table>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         20, 'Beginner', '📋'),

        # DIGITAL SKILLS
        ('Using AgriBridge on WhatsApp', 'digital',
         'Complete guide to ordering, selling, and getting alerts via WhatsApp.',
         '''<h3>Why WhatsApp?</h3>
<p>85% of Ugandan smartphone users already have WhatsApp. AgriBridge uses WhatsApp so you do not need to learn a new app. Everything works on the messaging platform you already know.</p>

<h3>How to Connect Your WhatsApp to AgriBridge</h3>
<ol>
<li>Register on AgriBridge (website or by dialling *789#)</li>
<li>Save the AgriBridge number in your phone: <strong>+256 755 966 690</strong></li>
<li>Send "HELLO" to that number on WhatsApp</li>
<li>You will receive a welcome message with your account linked</li>
</ol>

<h3>WhatsApp Commands You Can Use</h3>
<ul>
<li><strong>PRICES</strong> - Get today's prices for all crops</li>
<li><strong>PRICES [crop]</strong> - e.g. "PRICES TOMATOES" for tomato prices only</li>
<li><strong>SELL [crop] [kg] [price]</strong> - e.g. "SELL TOMATOES 200 7500" to list your produce</li>
<li><strong>BUY [crop] [kg]</strong> - e.g. "BUY BEANS 50" to find sellers</li>
<li><strong>WEATHER [district]</strong> - e.g. "WEATHER WAKISO"</li>
<li><strong>ORDERS</strong> - See your recent orders</li>
<li><strong>HELP</strong> - See all commands</li>
</ul>

<h3>Receiving Alerts on WhatsApp</h3>
<p>Once registered, AgriBridge will automatically send you:</p>
<ul>
<li>Price alerts when your crop's price changes significantly</li>
<li>Order confirmations when someone buys your produce</li>
<li>Weather advisories every morning during planting season</li>
<li>Payment confirmations when money arrives in your Mobile Money</li>
</ul>

<h3>For Buyers: Ordering via WhatsApp</h3>
<ol>
<li>Browse the marketplace on the website</li>
<li>Click "Order via WhatsApp" on any product</li>
<li>A message is pre-filled for you - just press Send</li>
<li>The farmer or vendor confirms and arranges delivery</li>
</ol>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         15, 'Beginner', '📱'),

        ('USSD *789# Full Tutorial', 'digital',
         'Every menu option in *789# explained with practice exercises.',
         '''<h3>What is USSD?</h3>
<p>USSD (Unstructured Supplementary Service Data) is a technology that lets you access services by dialling a code like *789#. It works on <strong>every mobile phone</strong> - even the cheapest UGX 15,000 phone - without internet.</p>

<h3>How to Start</h3>
<ol>
<li>On any phone, dial <strong>*789#</strong> and press Call</li>
<li>The AgriBridge menu appears on your screen</li>
<li>Type a number and press Send or OK to navigate</li>
<li>Session lasts about 3 minutes - work quickly</li>
</ol>

<h3>Complete Menu Guide</h3>

<h3>Option 1: Check Prices</h3>
<p>Shows today's prices for all major crops in Kampala market. Updated twice daily (7am and 1pm). Free to check anytime.</p>

<h3>Option 2: List My Produce</h3>
<p>To list produce for sale:</p>
<ul>
<li>Type your crop, quantity, and price separated by commas</li>
<li>Example: TOMATO,200,7500 (means 200kg of tomatoes at UGX 7,500/kg)</li>
<li>You will receive an SMS confirmation with a listing ID</li>
<li>Buyers will see your listing and can contact you</li>
</ul>

<h3>Option 3: My Orders</h3>
<p>Check status of all your current orders. Each order has a reference number (e.g. AB-2026-3847) you can use to track it.</p>

<h3>Option 4: Weather & Advisory</h3>
<p>Get the current weather for your district and today's farming advice. Includes whether to plant, spray or irrigate.</p>

<h3>Option 5: Talk to Agent</h3>
<p>Find the nearest AgriBridge village agent. Agents can help you register, resolve disputes, or make transactions on your behalf.</p>

<h3>Practice Exercise</h3>
<p>Try the USSD simulator on the AgriBridge website homepage. It works exactly like the real *789# menu so you can practice before using your airtime.</p>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         20, 'Beginner', '📞'),

        # POST-HARVEST
        ('Post-Harvest Handling Basics', 'postharvest',
         'Temperature, humidity and packaging to extend shelf life.',
         '''<h3>Why Proper Post-Harvest Handling Matters</h3>
<p>Uganda loses 30% of all fresh produce between harvest and market. That is money lost before you even sell anything. With simple low-cost techniques, you can reduce losses to under 10%.</p>

<h3>The 5 Main Causes of Post-Harvest Loss</h3>
<ol>
<li><strong>Heat</strong> - Produce left in direct sun deteriorates in hours</li>
<li><strong>Mechanical damage</strong> - Rough handling, overfilling crates, stacking too high</li>
<li><strong>Moisture loss</strong> - Produce dries out in the open air</li>
<li><strong>Disease</strong> - One rotten tomato infects the whole crate</li>
<li><strong>Delay</strong> - Taking too long to get to market</li>
</ol>

<h3>Immediately After Harvest</h3>
<ul>
<li>Harvest in the cool of the morning (before 9am)</li>
<li>Place produce in shade immediately - never on the ground in sun</li>
<li>Handle gently - drops cause bruising which leads to rot</li>
<li>Sort immediately: remove all damaged or diseased produce</li>
<li>Do not mix different maturity levels in the same crate</li>
</ul>

<h3>Simple Cooling Methods</h3>
<ul>
<li><strong>Evaporative cooler:</strong> Wet sacks around crates. As water evaporates it cools the produce.</li>
<li><strong>Shade structure:</strong> A simple roof of banana leaves over your storage area can reduce temperature by 8-10 degrees.</li>
<li><strong>Night harvesting:</strong> For some crops, harvest in the evening when it is cool.</li>
</ul>

<h3>How AgriBridge Helps</h3>
<p>When you list produce for sale, AgriBridge connects you with buyers before you even harvest. This means your produce goes from farm to buyer faster, reducing time in storage and therefore losses.</p>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         20, 'Beginner', '📦'),

        # FINANCE
        ('SACCO & Group Savings', 'finance',
         'How to join or form a SACCO with fellow farmers for credit access.',
         '''<h3>What is a SACCO?</h3>
<p>A SACCO (Savings and Credit Cooperative Organisation) is a group of people who save money together and give each other loans. SACCOs give farmers access to credit that banks usually refuse them.</p>

<h3>How a SACCO Works</h3>
<ol>
<li>A group of 10-30 farmers meets regularly (weekly or monthly)</li>
<li>Each member saves a fixed amount every meeting (e.g. UGX 10,000)</li>
<li>After 3-6 months, members can borrow 2-3x what they have saved</li>
<li>Loans are charged a small interest (usually 2-5% per month)</li>
<li>Interest earned goes back to members as dividends</li>
</ol>

<h3>Benefits of SACCO Membership</h3>
<ul>
<li>Access to emergency credit when you need inputs before harvest</li>
<li>Forced savings habit helps you plan for next season</li>
<li>Group can negotiate better prices when buying inputs together</li>
<li>Mutual support when one member has a bad season</li>
</ul>

<h3>How to Join or Start a SACCO</h3>
<ul>
<li>Contact your local NAADS extension worker - they know local SACCOs</li>
<li>The Uganda Cooperative Alliance (UCA) can help you register</li>
<li>Minimum to register: 30 members and UGX 500,000 share capital</li>
<li>For existing SACCOs: ask your local LC1 leader for contacts</li>
</ul>

<h3>AgriBridge and SACCOs</h3>
<p>Your AgriBridge transaction history (sales, orders, payments) can be used as proof of income when applying for a SACCO loan or bank credit. Register on AgriBridge and build your digital financial history starting today.</p>''',
         'https://www.youtube.com/embed/dQw4w9WgXcQ',
         20, 'Beginner', '💼'),
    ]

    db.executemany("""
        INSERT INTO training_modules (title, category, description, content, video_url, duration_min, level, emoji)
        VALUES (?,?,?,?,?,?,?,?)
    """, modules_data)

    # ── SEED DISTRICTS ───────────────────────────────────────────────────────
    districts_data = [
        ('Kampala', 'Central', 847, 98, 1, 0.3476, 32.5825),
        ('Wakiso', 'Central', 612, 91, 1, 0.3429, 32.5880),
        ('Mukono', 'Central', 445, 86, 1, 0.3564, 32.7531),
        ('Jinja', 'Eastern', 312, 78, 2, 0.6048, 33.2035),
        ('Mbarara', 'Western', 521, 83, 2, -0.6117, 30.6545),
        ('Masaka', 'Central', 289, 74, 2, -0.0512, 32.4478),
        ('Gulu', 'Northern', 198, 62, 3, 2.7748, 32.2990),
        ('Mbale', 'Eastern', 176, 58, 3, 1.1167, 34.1667),
        ('Fort Portal', 'Western', 145, 55, 3, 0.4514, 30.2746),
        ('Soroti', 'Eastern', 98, 44, 4, 0.9960, 33.9350),
        ('Lira', 'Northern', 87, 41, 4, 2.1478, 31.6683),
        ('Kabale', 'Western', 76, 38, 4, -1.2494, 29.9864),
    ]
    db.executemany("""
        INSERT INTO districts (name, region, farmer_count, priority_score, phase, lat, lng)
        VALUES (?,?,?,?,?,?,?)
    """, districts_data)

    # ── SEED REVIEWS ─────────────────────────────────────────────────────────
    reviews_data = [
        (3, 1, None, 5, 'Tomatoes were Grade A, exactly as described. Delivery was on time.'),
        (4, 1, None, 5, 'Nakato is very reliable. We have made her our primary tomato supplier.'),
        (3, 5, None, 4, 'Good quality peppers. Slight delay in delivery but overall excellent.'),
        (2, 7, None, 5, 'David is a top farmer. His onions last very long in storage.'),
    ]
    db.executemany("""
        INSERT INTO reviews (reviewer_id, reviewed_id, order_id, rating, comment)
        VALUES (?,?,?,?,?)
    """, reviews_data)

    db.commit()
    print("✅ Sample data seeded successfully.")
    print("   Users: 8 | Listings: 10 | Prices: 10 | Modules: 10 | Districts: 12")


# ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def generate_ref():
    return 'AB-' + datetime.now().strftime('%Y') + '-' + ''.join(random.choices(string.digits, k=6))

def generate_ussd_code():
    return 'AB' + ''.join(random.choices(string.digits, k=6))

def success(data=None, message='Success'):
    return jsonify({'status': 'success', 'message': message, 'data': data})

def error(message='Error', code=400):
    return jsonify({'status': 'error', 'message': message}), code


# ─── API ROUTES ───────────────────────────────────────────────────────────────

# ── AUTH ──────────────────────────────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def register():
    """
    Register a new user.
    Body: name, phone, password, role, district, ...
    """
    data = request.json or {}
    required = ['name', 'phone', 'role']
    for f in required:
        if not data.get(f):
            return error(f'Field "{f}" is required')

    # Check phone not already registered
    existing = query_db("SELECT id FROM users WHERE phone = ?", [data['phone']], one=True)
    if existing:
        return error('Phone number already registered. Please sign in instead.')

    # Validate role
    valid_roles = ['farmer', 'vendor', 'buyer', 'hotel']
    if data['role'] not in valid_roles:
        return error('Invalid role. Choose: farmer, vendor, buyer, or hotel')

    pw_hash = hash_password(data.get('password', 'default123'))
    ussd_code = generate_ussd_code()

    user_id = execute_db("""
        INSERT INTO users (name, phone, email, password_hash, role, district, address, national_id, trust_score, ussd_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data['name'], data['phone'], data.get('email'),
        pw_hash, data['role'], data.get('district'),
        data.get('address'), data.get('national_id'),
        60, ussd_code
    ))

    # Create role-specific profile
    if data['role'] == 'farmer':
        execute_db("""
            INSERT INTO farmer_profiles (user_id, farm_size_acres, primary_crops, monthly_output_kg, momo_number, main_challenge)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            user_id, data.get('farm_size_acres'),
            json.dumps(data.get('primary_crops', [])),
            data.get('monthly_output_kg'),
            data.get('momo_number'), data.get('main_challenge')
        ))

    elif data['role'] == 'vendor':
        execute_db("""
            INSERT INTO vendor_profiles (user_id, business_name, market_location, product_categories, weekly_volume_kg, delivery_radius_km, buyer_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, data.get('business_name', data['name']),
            data.get('market_location'), json.dumps(data.get('product_categories', [])),
            data.get('weekly_volume_kg'), data.get('delivery_radius_km'), data.get('buyer_type')
        ))

    elif data['role'] == 'hotel':
        execute_db("""
            INSERT INTO hotel_profiles (user_id, hotel_type, contact_person, weekly_volume_kg, delivery_time, quality_grade, special_needs)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, data.get('hotel_type'), data.get('contact_person'),
            data.get('weekly_volume_kg'), data.get('delivery_time'),
            data.get('quality_grade'), data.get('special_needs')
        ))

    # Log welcome SMS
    welcome_msg = f"Welcome to AgriBridge, {data['name']}! Your code: {ussd_code}. Dial *789# from any phone for prices, buyers and weather."
    execute_db("INSERT INTO sms_log (recipient, message, type) VALUES (?, ?, ?)",
               (data['phone'], welcome_msg, 'welcome'))

    # Return user data (no password)
    user = row_to_dict(query_db("SELECT id, name, phone, role, district, trust_score, ussd_code, created_at FROM users WHERE id = ?", [user_id], one=True))
    return success(user, f'Welcome to AgriBridge, {data["name"]}!')


@app.route('/api/auth/login', methods=['POST'])
def login():
    """Login with phone + password."""
    data = request.json or {}
    phone = data.get('phone', '').strip()
    password = data.get('password', '')

    if not phone or not password:
        return error('Phone and password are required')

    user = query_db("""
        SELECT id, name, phone, role, district, trust_score, ussd_code, is_active, password_hash, created_at
        FROM users WHERE phone = ?
    """, [phone], one=True)

    if not user:
        return error('Phone number not found. Please register first.')

    user_dict = row_to_dict(user)
    if not user_dict['is_active']:
        return error('This account has been deactivated. Contact support.')

    if user_dict['password_hash'] != hash_password(password):
        return error('Incorrect password.')

    # Update last login
    execute_db("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user_dict['id']])

    # Remove password from response
    del user_dict['password_hash']
    del user_dict['is_active']

    # Get role-specific profile
    profile = get_user_profile(user_dict['id'], user_dict['role'])
    user_dict['profile'] = profile

    return success(user_dict, f'Welcome back, {user_dict["name"]}!')


def get_user_profile(user_id, role):
    """Get the role-specific profile for a user."""
    if role == 'farmer':
        row = query_db("SELECT * FROM farmer_profiles WHERE user_id = ?", [user_id], one=True)
    elif role == 'vendor':
        row = query_db("SELECT * FROM vendor_profiles WHERE user_id = ?", [user_id], one=True)
    elif role == 'hotel':
        row = query_db("SELECT * FROM hotel_profiles WHERE user_id = ?", [user_id], one=True)
    else:
        return {}
    return row_to_dict(row)


@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    """Get a user profile by ID."""
    user = query_db("""
        SELECT id, name, phone, email, role, district, address, trust_score, ussd_code, is_verified, created_at
        FROM users WHERE id = ? AND is_active = 1
    """, [user_id], one=True)
    if not user:
        return error('User not found', 404)
    user_dict = row_to_dict(user)
    user_dict['profile'] = get_user_profile(user_id, user_dict['role'])

    # Get average rating
    rating = query_db("SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE reviewed_id = ?", [user_id], one=True)
    user_dict['avg_rating'] = round(rating['avg_rating'] or 0, 1)
    user_dict['review_count'] = rating['count']
    return success(user_dict)


# ── LISTINGS / MARKETPLACE ────────────────────────────────────────────────────
@app.route('/api/listings', methods=['GET'])
def get_listings():
    """
    Get all active listings.
    Query params: category, district, min_price, max_price, search, limit, offset
    """
    category = request.args.get('category')
    district = request.args.get('district')
    search = request.args.get('search')
    limit = int(request.args.get('limit', 20))
    offset = int(request.args.get('offset', 0))

    sql = """
        SELECT l.*, u.name as seller_name, u.district as seller_district,
               u.trust_score,
               COALESCE(AVG(r.rating), 0) as avg_rating,
               COUNT(r.id) as review_count
        FROM listings l
        JOIN users u ON l.seller_id = u.id
        LEFT JOIN reviews r ON r.reviewed_id = u.id
        WHERE l.is_active = 1
    """
    args = []

    if category:
        sql += " AND l.category = ?"
        args.append(category)
    if district:
        sql += " AND l.district LIKE ?"
        args.append(f'%{district}%')
    if search:
        sql += " AND (l.title LIKE ? OR l.description LIKE ?)"
        args.extend([f'%{search}%', f'%{search}%'])

    sql += " GROUP BY l.id ORDER BY l.created_at DESC LIMIT ? OFFSET ?"
    args.extend([limit, offset])

    rows = query_db(sql, args)
    listings = rows_to_list(rows)

    # Increment view count
    return success({'listings': listings, 'count': len(listings), 'offset': offset})


@app.route('/api/listings/<int:listing_id>', methods=['GET'])
def get_listing(listing_id):
    """Get a single listing with full details."""
    row = query_db("""
        SELECT l.*, u.name as seller_name, u.phone as seller_phone,
               u.district as seller_district, u.trust_score
        FROM listings l
        JOIN users u ON l.seller_id = u.id
        WHERE l.id = ? AND l.is_active = 1
    """, [listing_id], one=True)
    if not row:
        return error('Listing not found', 404)

    # Increment view count
    execute_db("UPDATE listings SET views = views + 1 WHERE id = ?", [listing_id])
    return success(row_to_dict(row))


@app.route('/api/listings', methods=['POST'])
def create_listing():
    """Create a new product listing (for logged-in farmers/vendors)."""
    data = request.json or {}
    required = ['seller_id', 'title', 'category', 'price_ugx', 'unit']
    for f in required:
        if not data.get(f):
            return error(f'Field "{f}" is required')

    # Verify seller exists
    seller = query_db("SELECT id, role FROM users WHERE id = ?", [data['seller_id']], one=True)
    if not seller:
        return error('Seller not found')
    if seller['role'] not in ['farmer', 'vendor']:
        return error('Only farmers and vendors can create listings')

    listing_id = execute_db("""
        INSERT INTO listings (seller_id, title, category, price_ugx, unit, quantity_kg, district,
                             description, emoji, badge, quality_grade, is_organic, harvest_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data['seller_id'], data['title'], data['category'],
        data['price_ugx'], data['unit'],
        data.get('quantity_kg'), data.get('district'),
        data.get('description', ''), data.get('emoji', '🌿'),
        data.get('badge', 'Fresh'), data.get('quality_grade', 'B'),
        1 if data.get('is_organic') else 0, data.get('harvest_date')
    ))

    return success({'listing_id': listing_id}, 'Listing created successfully!')


@app.route('/api/listings/<int:listing_id>', methods=['DELETE'])
def delete_listing(listing_id):
    """Deactivate (soft-delete) a listing."""
    execute_db("UPDATE listings SET is_active = 0 WHERE id = ?", [listing_id])
    return success(message='Listing removed')


# ── ORDERS ────────────────────────────────────────────────────────────────────
@app.route('/api/orders', methods=['POST'])
def create_order():
    """Place a new order."""
    data = request.json or {}
    required = ['buyer_id', 'seller_id', 'listing_id', 'quantity', 'total_ugx']
    for f in required:
        if data.get(f) is None:
            return error(f'Field "{f}" is required')

    ref = generate_ref()
    order_id = execute_db("""
        INSERT INTO orders (buyer_id, seller_id, listing_id, quantity, total_ugx, delivery_address, notes, order_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data['buyer_id'], data['seller_id'], data['listing_id'],
        data['quantity'], data['total_ugx'],
        data.get('delivery_address', ''), data.get('notes', ''), ref
    ))

    # Get listing and users for SMS notifications
    listing = query_db("SELECT title, price_ugx FROM listings WHERE id = ?", [data['listing_id']], one=True)
    buyer = query_db("SELECT name, phone FROM users WHERE id = ?", [data['buyer_id']], one=True)
    seller = query_db("SELECT name, phone FROM users WHERE id = ?", [data['seller_id']], one=True)

    if listing and buyer and seller:
        # SMS to seller
        execute_db("INSERT INTO sms_log (recipient, message, type) VALUES (?, ?, ?)", (
            seller['phone'],
            f"New order #{ref}! {buyer['name']} wants {data['quantity']} {listing['title']} = UGX {data['total_ugx']:,}. Confirm via *789# option 3.",
            'order_notify'
        ))
        # SMS to buyer
        execute_db("INSERT INTO sms_log (recipient, message, type) VALUES (?, ?, ?)", (
            buyer['phone'],
            f"Order #{ref} placed! {listing['title']} from {seller['name']}. Total: UGX {data['total_ugx']:,}. We'll confirm within 2 hours.",
            'order_confirm'
        ))

    return success({'order_id': order_id, 'order_ref': ref}, f'Order placed! Reference: {ref}')


@app.route('/api/orders/<int:user_id>', methods=['GET'])
def get_user_orders(user_id):
    """Get all orders for a user (as buyer or seller)."""
    orders = query_db("""
        SELECT o.*, l.title as product_name, l.emoji,
               b.name as buyer_name, s.name as seller_name
        FROM orders o
        JOIN listings l ON o.listing_id = l.id
        JOIN users b ON o.buyer_id = b.id
        JOIN users s ON o.seller_id = s.id
        WHERE o.buyer_id = ? OR o.seller_id = ?
        ORDER BY o.created_at DESC
        LIMIT 50
    """, [user_id, user_id])
    return success(rows_to_list(orders))


@app.route('/api/orders/<string:order_ref>/status', methods=['PUT'])
def update_order_status(order_ref):
    """Update order status (confirm, mark as delivered, etc.)."""
    data = request.json or {}
    new_status = data.get('status')
    valid_statuses = ['pending', 'confirmed', 'in_transit', 'delivered', 'cancelled']
    if new_status not in valid_statuses:
        return error(f'Invalid status. Must be one of: {", ".join(valid_statuses)}')

    execute_db("""
        UPDATE orders SET status = ?, updated_at = datetime('now') WHERE order_ref = ?
    """, [new_status, order_ref])
    return success(message=f'Order status updated to: {new_status}')


# ── PRICES ────────────────────────────────────────────────────────────────────
@app.route('/api/prices', methods=['GET'])
def get_prices():
    """Get latest prices for all crops."""
    district = request.args.get('district', 'Kampala')
    rows = query_db("""
        SELECT p1.*
        FROM prices p1
        INNER JOIN (
            SELECT crop_name, MAX(recorded_at) as max_date
            FROM prices WHERE district = ?
            GROUP BY crop_name
        ) p2 ON p1.crop_name = p2.crop_name AND p1.recorded_at = p2.max_date
        ORDER BY p1.crop_name
    """, [district])

    if not rows:
        # Fallback to any district
        rows = query_db("SELECT * FROM prices GROUP BY crop_name ORDER BY crop_name")

    return success(rows_to_list(rows))


@app.route('/api/prices', methods=['POST'])
def add_price():
    """Add a new price record (for admin/data collection)."""
    data = request.json or {}
    required = ['crop_name', 'price_ugx']
    for f in required:
        if not data.get(f):
            return error(f'Field "{f}" is required')

    execute_db("""
        INSERT INTO prices (crop_name, emoji, price_ugx, unit, district, change_pct, trend)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        data['crop_name'], data.get('emoji', '🌿'), data['price_ugx'],
        data.get('unit', 'per kg'), data.get('district', 'Kampala'),
        data.get('change_pct', 0), data.get('trend', 'stable')
    ))
    return success(message='Price recorded')


# ── TRAINING ──────────────────────────────────────────────────────────────────
@app.route('/api/training/modules', methods=['GET'])
def get_modules():
    """Get all training modules, optionally filtered by category."""
    category = request.args.get('category')
    sql = "SELECT id, title, category, description, video_url, duration_min, level, emoji, is_active FROM training_modules WHERE is_active = 1"
    args = []
    if category:
        sql += " AND category = ?"
        args.append(category)
    sql += " ORDER BY category, level DESC"
    rows = query_db(sql, args)
    return success(rows_to_list(rows))


@app.route('/api/training/modules/<int:module_id>', methods=['GET'])
def get_module(module_id):
    """Get full content of a training module."""
    row = query_db("SELECT * FROM training_modules WHERE id = ? AND is_active = 1", [module_id], one=True)
    if not row:
        return error('Module not found', 404)
    return success(row_to_dict(row))


@app.route('/api/training/progress', methods=['POST'])
def save_progress():
    """Save or update a user's progress on a module."""
    data = request.json or {}
    user_id = data.get('user_id')
    module_id = data.get('module_id')
    progress = data.get('progress_pct', 0)

    if not user_id or not module_id:
        return error('user_id and module_id are required')

    # Upsert (insert or update)
    existing = query_db("SELECT id FROM user_progress WHERE user_id = ? AND module_id = ?", [user_id, module_id], one=True)
    if existing:
        execute_db("""
            UPDATE user_progress SET progress_pct = ?,
            completed = ?, completed_at = CASE WHEN ? >= 100 THEN datetime('now') ELSE NULL END
            WHERE user_id = ? AND module_id = ?
        """, [progress, 1 if progress >= 100 else 0, progress, user_id, module_id])
    else:
        execute_db("""
            INSERT INTO user_progress (user_id, module_id, progress_pct, completed)
            VALUES (?, ?, ?, ?)
        """, [user_id, module_id, progress, 1 if progress >= 100 else 0])

    return success({'progress_pct': progress}, 'Progress saved')


@app.route('/api/training/progress/<int:user_id>', methods=['GET'])
def get_user_progress(user_id):
    """Get all training progress for a user."""
    rows = query_db("""
        SELECT up.*, tm.title, tm.category, tm.emoji, tm.duration_min
        FROM user_progress up
        JOIN training_modules tm ON up.module_id = tm.id
        WHERE up.user_id = ?
        ORDER BY up.started_at DESC
    """, [user_id])

    # Calculate overall stats
    all_modules = query_db("SELECT COUNT(*) as total FROM training_modules WHERE is_active = 1", one=True)
    completed = query_db("SELECT COUNT(*) as done FROM user_progress WHERE user_id = ? AND completed = 1", [user_id], one=True)

    total = all_modules['total'] if all_modules else 1
    done = completed['done'] if completed else 0

    return success({
        'modules': rows_to_list(rows),
        'total_modules': total,
        'completed': done,
        'percent': round((done / total) * 100) if total > 0 else 0
    })


# ── MATCHING ENGINE ────────────────────────────────────────────────────────────
@app.route('/api/match', methods=['POST'])
def match_farmers():
    """
    Find farmers matching a buyer's requirements.
    Body: crop, district, volume, grade, buyer_type
    """
    data = request.json or {}
    crop = data.get('crop', '').lower()
    district = data.get('district', '').lower()
    grade = data.get('grade', '').lower()

    # Get farmers with matching criteria
    sql = """
        SELECT u.id, u.name, u.district, u.trust_score, u.phone,
               fp.primary_crops, fp.monthly_output_kg, fp.farm_size_acres,
               COALESCE(AVG(r.rating), 4.0) as rating,
               COUNT(r.id) as review_count
        FROM users u
        JOIN farmer_profiles fp ON u.id = fp.user_id
        LEFT JOIN reviews r ON r.reviewed_id = u.id
        WHERE u.role = 'farmer' AND u.is_active = 1
        GROUP BY u.id
    """
    farmers = rows_to_list(query_db(sql))

    results = []
    for f in farmers:
        score = 60  # Base score

        # Crop match
        try:
            crops_list = json.loads(f.get('primary_crops') or '[]')
            if any(crop in c.lower() for c in crops_list):
                score += 20
        except:
            pass

        # District match
        if district and f.get('district', '').lower().startswith(district[:4]):
            score += 15
        elif f.get('district', '').lower() in ['kampala', 'wakiso', 'mukono']:
            score += 8  # Close to Kampala

        # Trust score contribution
        trust = f.get('trust_score', 60)
        score += int((trust - 60) / 4)  # Add up to +10 points

        # Rating contribution
        rating = float(f.get('rating') or 4.0)
        score += int((rating - 4.0) * 5)  # Add up to +5

        if score > 100:
            score = 100

        results.append({
            'id': f['id'],
            'name': f['name'],
            'district': f['district'],
            'crops': f.get('primary_crops', '[]'),
            'monthly_output_kg': f.get('monthly_output_kg'),
            'trust_score': f.get('trust_score'),
            'rating': round(rating, 1),
            'review_count': f.get('review_count', 0),
            'match_score': score
        })

    # Sort by score, highest first
    results.sort(key=lambda x: x['match_score'], reverse=True)

    return success({
        'matches': results[:8],
        'total': len(results)
    })


@app.route('/api/match/connect', methods=['POST'])
def connect_match():
    """Record a connection between vendor and farmer."""
    data = request.json or {}
    vendor_id = data.get('vendor_id')
    farmer_id = data.get('farmer_id')
    crop = data.get('crop', '')

    if not vendor_id or not farmer_id:
        return error('vendor_id and farmer_id are required')

    match_id = execute_db("""
        INSERT INTO matches (vendor_id, farmer_id, crop, score_pct, status)
        VALUES (?, ?, ?, ?, 'connected')
    """, [vendor_id, farmer_id, crop, data.get('score', 0)])

    # SMS farmer about the connection
    farmer = query_db("SELECT name, phone FROM users WHERE id = ?", [farmer_id], one=True)
    vendor = query_db("SELECT name FROM users WHERE id = ?", [vendor_id], one=True)
    if farmer and vendor:
        execute_db("INSERT INTO sms_log (recipient, message, type) VALUES (?, ?, ?)", (
            farmer['phone'],
            f"AgriBridge: {vendor['name']} wants to buy your {crop}! Call them or reply on WhatsApp. Reference: MATCH-{match_id}",
            'match_notify'
        ))

    return success({'match_id': match_id}, 'Connection initiated!')


# ── USSD SIMULATOR ────────────────────────────────────────────────────────────
@app.route('/api/ussd', methods=['POST'])
def handle_ussd():
    """
    Process USSD input and return the next menu screen.
    This simulates what *789# does on a real phone.

    Body: session_id, phone, input, current_menu
    """
    data = request.json or {}
    phone = data.get('phone', 'unknown')
    user_input = data.get('input', '').strip()
    session_id = data.get('session_id', 'web-' + phone)
    current_menu = data.get('current_menu', 'home')

    # Get or create session
    session = query_db("SELECT * FROM ussd_sessions WHERE session_id = ?", [session_id], one=True)
    if session:
        current_menu = session['current_menu']
        session_data = json.loads(session['session_data'] or '{}')
    else:
        session_data = {}
        execute_db("""
            INSERT INTO ussd_sessions (session_id, phone, current_menu, session_data)
            VALUES (?, ?, 'home', '{}')
        """, [session_id, phone])
        current_menu = 'home'

    # Get prices from DB for the prices menu
    prices = rows_to_list(query_db("SELECT crop_name, price_ugx, change_pct, trend FROM prices GROUP BY crop_name LIMIT 6"))

    # Build price list string
    trend_arrow = lambda t: '▲' if t == 'up' else ('▼' if t == 'down' else '-')
    price_lines = '\n'.join([
        f"{p['crop_name']}: UGX {p['price_ugx']:,}/kg {trend_arrow(p['trend'])}{abs(p['change_pct'])}%"
        for p in prices
    ])

    # USSD Menu Logic
    response_text = ''
    next_menu = current_menu

    if current_menu == 'home' or user_input == '0' or not user_input:
        response_text = (
            "Welcome to AgriBridge!\n"
            "Uganda Farm Platform\n\n"
            "1. Check Prices\n"
            "2. List My Produce\n"
            "3. My Orders\n"
            "4. Weather & Advisory\n"
            "5. Talk to Agent\n"
            "6. My Account\n\n"
            "Reply with a number:"
        )
        next_menu = 'home'

    elif current_menu == 'home' and user_input == '1':
        response_text = (
            f"TODAY'S KAMPALA PRICES:\n\n"
            f"{price_lines}\n\n"
            "0. Back  9. More crops"
        )
        next_menu = 'prices'

    elif current_menu == 'home' and user_input == '2':
        response_text = (
            "LIST YOUR PRODUCE\n\n"
            "Format: CROP,KG,PRICE\n"
            "Example: TOMATO,200,7500\n\n"
            "Enter details:"
        )
        next_menu = 'list_produce'

    elif current_menu == 'list_produce':
        if ',' in user_input:
            parts = [p.strip() for p in user_input.split(',')]
            if len(parts) >= 3:
                crop = parts[0].upper()
                try:
                    kg = int(parts[1])
                    price = int(parts[2])
                    ref = generate_ref()

                    # Log the listing attempt as SMS
                    execute_db("INSERT INTO sms_log (recipient, message, type) VALUES (?, ?, ?)", (
                        phone,
                        f"Listing received! {crop} {kg}kg @ UGX {price:,}/kg. ID: {ref}. We will SMS you when a buyer is found.",
                        'listing_confirm'
                    ))

                    response_text = (
                        f"LISTING RECEIVED!\n\n"
                        f"Crop: {crop}\n"
                        f"Quantity: {kg}kg\n"
                        f"Price: UGX {price:,}/kg\n"
                        f"ID: {ref}\n\n"
                        "We will SMS you when\na buyer is found.\n\n"
                        "0. Main menu"
                    )
                    next_menu = 'home'
                except ValueError:
                    response_text = "Invalid format.\nUse: CROP,KG,PRICE\nExample: TOMATO,200,7500\n\n0. Back"
            else:
                response_text = "Please enter all 3 values:\nCROP,KG,PRICE\n\n0. Back"
        else:
            response_text = "Invalid format.\nUse: CROP,KG,PRICE\nExample: TOMATO,200,7500\n\n0. Back"
            next_menu = 'home'

    elif current_menu == 'home' and user_input == '3':
        # Look up real orders from DB
        user = query_db("SELECT id FROM users WHERE phone = ?", [phone], one=True)
        if user:
            orders = rows_to_list(query_db("""
                SELECT o.order_ref, l.title, o.total_ugx, o.status, o.created_at
                FROM orders o JOIN listings l ON o.listing_id = l.id
                WHERE o.buyer_id = ? OR o.seller_id = ?
                ORDER BY o.created_at DESC LIMIT 3
            """, [user['id'], user['id']]))

            if orders:
                order_lines = '\n\n'.join([
                    f"{o['order_ref']}\n{o['title']}\nUGX {o['total_ugx']:,}\nStatus: {o['status'].upper()}"
                    for o in orders
                ])
                response_text = f"YOUR ORDERS:\n\n{order_lines}\n\n0. Back"
            else:
                response_text = "No orders yet.\n\n0. Back to menu"
        else:
            response_text = "Account not found.\nRegister at agribridge.ug\n\n0. Back"
        next_menu = 'orders'

    elif current_menu == 'home' and user_input == '4':
        response_text = (
            "WEATHER ADVISORY:\n\n"
            "Kampala Today\n"
            "26°C - Partly cloudy\n"
            "Humidity: 72%\n"
            "Rain chance: 35%\n\n"
            "ADVISORY: Good for planting.\n"
            "Transplant tomatoes & beans.\n"
            "Delay fertiliser 24hrs.\n\n"
            "0. Back"
        )
        next_menu = 'weather'

    elif current_menu == 'home' and user_input == '5':
        response_text = (
            "AGENT SUPPORT:\n\n"
            "Nearest agent:\n"
            "Okello James (Wakiso)\n"
            "+256 772 345 678\n\n"
            "Hours: 7am-7pm daily\n"
            "Free farm visits available\n\n"
            "0. Back"
        )
        next_menu = 'agent'

    elif current_menu == 'home' and user_input == '6':
        user = query_db("SELECT name, role, trust_score, ussd_code FROM users WHERE phone = ?", [phone], one=True)
        if user:
            response_text = (
                f"MY ACCOUNT:\n\n"
                f"Name: {user['name']}\n"
                f"Role: {user['role'].upper()}\n"
                f"Trust Score: {user['trust_score']}/100\n"
                f"Code: {user['ussd_code']}\n\n"
                "0. Back"
            )
        else:
            response_text = "Not registered.\nJoin at agribridge.ug\nor text JOIN to 8282\n\n0. Back"
        next_menu = 'account'

    elif current_menu == 'prices' and user_input == '9':
        more_prices = rows_to_list(query_db("SELECT crop_name, price_ugx, change_pct, trend FROM prices GROUP BY crop_name"))
        extra_lines = '\n'.join([
            f"{p['crop_name']}: UGX {p['price_ugx']:,} {trend_arrow(p['trend'])}"
            for p in more_prices[6:]
        ]) if len(more_prices) > 6 else "No more crops listed."
        response_text = f"MORE CROPS:\n\n{extra_lines}\n\n0. Back  1. Main menu"
        next_menu = 'prices_more'

    else:
        response_text = (
            "Option not recognised.\n"
            "Please select a valid\nnumber or type 0 to go\nback to the main menu."
        )
        next_menu = current_menu

    # Update session
    execute_db("""
        UPDATE ussd_sessions SET current_menu = ?, updated_at = datetime('now')
        WHERE session_id = ?
    """, [next_menu, session_id])

    return success({
        'text': response_text,
        'next_menu': next_menu,
        'end_session': False
    })


# ── SMS ───────────────────────────────────────────────────────────────────────
@app.route('/api/sms', methods=['POST'])
def handle_sms():
    """
    Process incoming SMS commands (simulates 8282 short code).
    Body: phone, message
    """
    data = request.json or {}
    phone = data.get('phone', '')
    message = data.get('message', '').strip().upper()

    if not message:
        return error('Message is required')

    reply = ''

    if message.startswith('PRICES') or message.startswith('PRICE'):
        # Get crop-specific or all prices
        parts = message.split()
        if len(parts) > 1:
            crop_filter = parts[1]
            rows = query_db("""
                SELECT crop_name, price_ugx, change_pct, trend
                FROM prices WHERE UPPER(crop_name) LIKE ?
                GROUP BY crop_name
            """, [f'%{crop_filter}%'])
        else:
            rows = query_db("SELECT crop_name, price_ugx, change_pct, trend FROM prices GROUP BY crop_name LIMIT 8")

        if rows:
            lines = [f"{r['crop_name']}: UGX {r['price_ugx']:,}/kg" for r in rows]
            reply = 'AGRIBRIDGE PRICES:\n' + '\n'.join(lines) + '\nReply HELP for commands.'
        else:
            reply = 'No prices found for that crop. Try PRICES TOMATOES or just PRICES.'

    elif message.startswith('HELP'):
        reply = (
            'AGRIBRIDGE COMMANDS:\n'
            'PRICES - all prices\n'
            'PRICES [crop] - specific crop\n'
            'LIST [crop] [kg] [price]\n'
            'WEATHER [district]\n'
            'ORDERS - your order history\n'
            'AGENT - find local agent\n'
            'JOIN [name] [district] - register\n'
            'Dial *789# for full menu'
        )

    elif message.startswith('ORDERS'):
        user = query_db("SELECT id FROM users WHERE phone = ?", [phone], one=True)
        if user:
            orders = rows_to_list(query_db("""
                SELECT o.order_ref, l.title, o.total_ugx, o.status
                FROM orders o JOIN listings l ON o.listing_id = l.id
                WHERE o.buyer_id = ? OR o.seller_id = ?
                ORDER BY o.created_at DESC LIMIT 3
            """, [user['id'], user['id']]))
            if orders:
                lines = [f"{o['order_ref']}: {o['title']} UGX {o['total_ugx']:,} [{o['status'].upper()}]" for o in orders]
                reply = 'YOUR ORDERS:\n' + '\n'.join(lines)
            else:
                reply = 'No orders yet. Browse at agribridge.ug'
        else:
            reply = 'Phone not registered. Text JOIN [name] [district] to register.'

    elif message.startswith('AGENT'):
        reply = (
            'NEAREST AGENT:\n'
            'Okello James (Wakiso)\n'
            '+256 772 345 678\n'
            '7am-7pm Mon-Sat\n'
            'Free farm registration visits'
        )

    elif message.startswith('WEATHER'):
        parts = message.split()
        district = ' '.join(parts[1:]) if len(parts) > 1 else 'Kampala'
        reply = (
            f'WEATHER: {district}\n'
            '26°C - Partly cloudy\n'
            'Humidity: 72%\n'
            'Rain chance: 35%\n'
            'ADVISORY: Good planting day.'
        )

    elif message.startswith('LIST'):
        parts = message.split()
        if len(parts) >= 4:
            crop = parts[1]
            try:
                kg = int(parts[2])
                price = int(parts[3])
                ref = generate_ref()
                execute_db("INSERT INTO sms_log (recipient, message, type) VALUES (?, ?, ?)", (
                    phone,
                    f"Listed: {crop} {kg}kg @ UGX {price:,}. ID: {ref}",
                    'listing_sms'
                ))
                reply = f'LISTED: {crop} {kg}kg @ UGX {price:,}/kg\nID: {ref}\nWe will SMS when a buyer is found.'
            except ValueError:
                reply = 'Invalid format.\nUse: LIST TOMATOES 200 7500'
        else:
            reply = 'Format: LIST [crop] [kg] [price]\nExample: LIST TOMATOES 200 7500'

    elif message.startswith('JOIN'):
        parts = message.split()
        name = parts[1] if len(parts) > 1 else 'Farmer'
        district = ' '.join(parts[2:]) if len(parts) > 2 else 'Uganda'

        # Check if already registered
        existing = query_db("SELECT id FROM users WHERE phone = ?", [phone], one=True)
        if existing:
            reply = f'Phone already registered. Dial *789# to access your account.'
        else:
            ussd_code = generate_ussd_code()
            try:
                execute_db("""
                    INSERT INTO users (name, phone, role, district, trust_score, ussd_code)
                    VALUES (?, ?, 'farmer', ?, 60, ?)
                """, [name, phone, district, ussd_code])
                reply = (
                    f'REGISTERED! Welcome {name}!\n'
                    f'District: {district}\n'
                    f'Your code: {ussd_code}\n'
                    f'Dial *789# on any phone.\n'
                    'Reply HELP for commands.'
                )
            except:
                reply = 'Registration failed. Try again or call +256 755 966 690'

    elif message == 'YES':
        reply = (
            'ORDER CONFIRMED!\n'
            f'Ref: {generate_ref()}\n'
            'Rider will contact you.\n'
            'Pickup: Tomorrow 6am\n'
            'Payment: MoMo after delivery'
        )

    else:
        reply = 'Command not recognised.\nReply HELP for all commands\nor dial *789# for full menu.'

    # Log the reply SMS
    if reply:
        execute_db("INSERT INTO sms_log (recipient, message, type) VALUES (?, ?, ?)",
                   (phone, reply, 'sms_reply'))

    return success({'reply': reply, 'to': phone})


# ── CONTACT FORM ──────────────────────────────────────────────────────────────
@app.route('/api/contact', methods=['POST'])
def submit_contact():
    """Save a contact form submission."""
    data = request.json or {}
    required = ['name', 'contact_info', 'message']
    for f in required:
        if not data.get(f):
            return error(f'Field "{f}" is required')

    execute_db("""
        INSERT INTO contacts (name, contact_info, role, message)
        VALUES (?, ?, ?, ?)
    """, [data['name'], data['contact_info'], data.get('role', ''), data['message']])

    return success(message="Message received! We'll respond within a few hours.")


# ── DISTRICTS / MAP ───────────────────────────────────────────────────────────
@app.route('/api/districts', methods=['GET'])
def get_districts():
    """Get all district data for the feasibility map."""
    rows = query_db("SELECT * FROM districts ORDER BY priority_score DESC")
    return success(rows_to_list(rows))


# ── REVIEWS ───────────────────────────────────────────────────────────────────
@app.route('/api/reviews', methods=['POST'])
def add_review():
    """Leave a review for a farmer/vendor."""
    data = request.json or {}
    required = ['reviewer_id', 'reviewed_id', 'rating']
    for f in required:
        if data.get(f) is None:
            return error(f'Field "{f}" is required')

    rating = int(data['rating'])
    if not 1 <= rating <= 5:
        return error('Rating must be between 1 and 5')

    execute_db("""
        INSERT INTO reviews (reviewer_id, reviewed_id, order_id, rating, comment)
        VALUES (?, ?, ?, ?, ?)
    """, [data['reviewer_id'], data['reviewed_id'], data.get('order_id'), rating, data.get('comment', '')])

    # Update trust score based on average rating
    avg = query_db("SELECT AVG(rating) as avg FROM reviews WHERE reviewed_id = ?", [data['reviewed_id']], one=True)
    if avg and avg['avg']:
        new_score = min(100, max(0, int(50 + (float(avg['avg']) - 3) * 20)))
        execute_db("UPDATE users SET trust_score = ? WHERE id = ?", [new_score, data['reviewed_id']])

    return success(message='Review submitted. Thank you!')


# ── SMS LOG (ADMIN) ───────────────────────────────────────────────────────────
@app.route('/api/admin/sms', methods=['GET'])
def get_sms_log():
    """View recent SMS log (admin use)."""
    rows = query_db("SELECT * FROM sms_log ORDER BY sent_at DESC LIMIT 100")
    return success(rows_to_list(rows))


# ── STATS (for hero section counters) ─────────────────────────────────────────
@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get live platform statistics."""
    farmer_count = query_db("SELECT COUNT(*) as c FROM users WHERE role='farmer' AND is_active=1", one=True)['c']
    listing_count = query_db("SELECT COUNT(*) as c FROM listings WHERE is_active=1", one=True)['c']
    order_count = query_db("SELECT COUNT(*) as c FROM orders", one=True)['c']
    total_value = query_db("SELECT COALESCE(SUM(total_ugx),0) as s FROM orders WHERE status='delivered'", one=True)['s']

    return success({
        'farmers': farmer_count,
        'listings': listing_count,
        'orders': order_count,
        'total_value_ugx': total_value
    })


# ── SEARCH ────────────────────────────────────────────────────────────────────
@app.route('/api/search', methods=['GET'])
def search():
    """Search across listings, farmers, and modules."""
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return error('Search term must be at least 2 characters')

    results = {}

    # Search listings
    listings = rows_to_list(query_db("""
        SELECT l.id, l.title, l.price_ugx, l.emoji, l.category, u.name as seller_name
        FROM listings l JOIN users u ON l.seller_id = u.id
        WHERE l.is_active=1 AND (l.title LIKE ? OR l.description LIKE ?)
        LIMIT 5
    """, [f'%{q}%', f'%{q}%']))
    results['listings'] = listings

    # Search modules
    modules = rows_to_list(query_db("""
        SELECT id, title, category, emoji FROM training_modules
        WHERE is_active=1 AND (title LIKE ? OR description LIKE ?)
        LIMIT 3
    """, [f'%{q}%', f'%{q}%']))
    results['modules'] = modules

    # Search farmers
    farmers = rows_to_list(query_db("""
        SELECT u.id, u.name, u.district, fp.primary_crops
        FROM users u JOIN farmer_profiles fp ON u.id=fp.user_id
        WHERE u.is_active=1 AND (u.name LIKE ? OR fp.primary_crops LIKE ? OR u.district LIKE ?)
        LIMIT 5
    """, [f'%{q}%', f'%{q}%', f'%{q}%']))
    results['farmers'] = farmers

    return success(results)


# ── SERVE THE FRONTEND ────────────────────────────────────────────────────────
@app.route('/')
def serve_frontend():
    """Serve the main HTML file."""
    return send_from_directory('static', 'index.html')


# ── RUN ───────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("\n" + "="*55)
    print("  🌿 AgriBridge Backend Server")
    print("="*55)
    print("  Starting setup...")

    # Create static folder for the HTML file
    os.makedirs('static', exist_ok=True)

    # Initialise database
    with app.app_context():
        init_db()

    print("\n  ✅ Server ready!")
    print("  📡 API running at:  http://localhost:5000")
    print("  🌍 Open browser to: http://localhost:5000")
    print("  📚 API endpoints:")
    print("     POST /api/auth/register")
    print("     POST /api/auth/login")
    print("     GET  /api/listings")
    print("     POST /api/orders")
    print("     POST /api/ussd")
    print("     POST /api/sms")
    print("     GET  /api/training/modules")
    print("     POST /api/match")
    print("     GET  /api/prices")
    print("     GET  /api/stats")
    print("  Press Ctrl+C to stop\n")

    app.run(debug=True, port=5000, host='0.0.0.0')


from flask import send_from_directory

@app.route('/')
def home():
    return send_from_directory('.', 'agribridge.html')
