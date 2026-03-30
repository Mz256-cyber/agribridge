-- ============================================================
--  AGRIBRIDGE DATABASE SCHEMA
--  File: schema.sql
--  Database: SQLite (agribridge.db)
--
--  This file creates all tables used by the platform.
--  To run this manually:
--    sqlite3 agribridge.db < schema.sql
-- ============================================================

-- Turn on foreign key checks (links between tables)
PRAGMA foreign_keys = ON;

-- ─── TABLE 1: USERS ──────────────────────────────────────────────────────────
-- Stores every person who registers on AgriBridge.
-- Each person has ONE role: farmer, vendor, buyer, hotel, or admin.
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    name          TEXT     NOT NULL,
    phone         TEXT     NOT NULL UNIQUE,   -- Used as login username
    email         TEXT,
    password_hash TEXT,                       -- SHA-256 hash, never store plain passwords!
    role          TEXT     NOT NULL
                           CHECK(role IN ('farmer','vendor','buyer','hotel','admin')),
    district      TEXT,
    address       TEXT,
    national_id   TEXT,
    trust_score   INTEGER  DEFAULT 60,        -- 0-100 reputation score
    ussd_code     TEXT     UNIQUE,            -- Code for *789# access e.g. AB123456
    is_verified   INTEGER  DEFAULT 0,         -- 1 = ID verified by agent
    is_active     INTEGER  DEFAULT 1,         -- 0 = account suspended
    created_at    TEXT     DEFAULT (datetime('now')),
    last_login    TEXT
);

-- ─── TABLE 2: FARMER_PROFILES ─────────────────────────────────────────────────
-- Extra details that only farmers need.
-- Linked to users table via user_id.
CREATE TABLE IF NOT EXISTS farmer_profiles (
    id                INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER  NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    farm_size_acres   REAL,
    primary_crops     TEXT,    -- Stored as JSON: '["Tomatoes","Maize","Beans"]'
    monthly_output_kg INTEGER,
    gps_lat           REAL,    -- GPS latitude of farm
    gps_lng           REAL,    -- GPS longitude of farm
    momo_number       TEXT,    -- MTN or Airtel Mobile Money number for payments
    bank_account      TEXT,
    main_challenge    TEXT,    -- What is their biggest problem selling produce
    created_at        TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 3: VENDOR_PROFILES ─────────────────────────────────────────────────
-- Extra details for market vendors and agro-dealers.
CREATE TABLE IF NOT EXISTS vendor_profiles (
    id                   INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id              INTEGER  NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name        TEXT,
    market_location      TEXT,    -- e.g. "Nakasero Market, Stall 42"
    kcca_permit          TEXT,    -- Business permit number
    product_categories   TEXT,    -- JSON: '["Vegetables","Fruits","Grains"]'
    weekly_volume_kg     INTEGER,
    delivery_radius_km   INTEGER,
    buyer_type           TEXT,    -- Who they sell to: retail, hotels, supermarkets, mixed
    created_at           TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 4: HOTEL_PROFILES ──────────────────────────────────────────────────
-- Extra details for hotels, restaurants and institutional buyers.
CREATE TABLE IF NOT EXISTS hotel_profiles (
    id                INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER  NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    hotel_type        TEXT,    -- '5-Star Hotel', 'Restaurant', 'Lodge', 'Hospital', etc.
    contact_person    TEXT,    -- Head Chef or Procurement Manager name
    weekly_volume_kg  INTEGER,
    delivery_time     TEXT,    -- e.g. '5am-7am (pre-kitchen)'
    quality_grade     TEXT,    -- 'Grade A (Premium)', 'Grade B (Standard)', or 'Both'
    special_needs     TEXT,    -- Any special requirements or notes
    created_at        TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 5: LISTINGS ───────────────────────────────────────────────────────
-- Products that farmers or vendors put up for sale in the marketplace.
CREATE TABLE IF NOT EXISTS listings (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    seller_id     INTEGER  NOT NULL REFERENCES users(id),
    title         TEXT     NOT NULL,
    category      TEXT     NOT NULL
                           CHECK(category IN ('fresh','seeds','fertiliser','tools','other')),
    price_ugx     INTEGER  NOT NULL,           -- Price in Uganda Shillings
    unit          TEXT     NOT NULL,            -- 'per kg', 'per bunch', 'per bag', 'each'
    quantity_kg   INTEGER,
    district      TEXT,                         -- Where the produce is located
    description   TEXT,
    emoji         TEXT     DEFAULT '🌿',
    badge         TEXT     DEFAULT 'Fresh',     -- 'Fresh', 'Organic', 'Input'
    quality_grade TEXT     DEFAULT 'B',         -- 'A', 'B', or 'C'
    is_organic    INTEGER  DEFAULT 0,
    is_active     INTEGER  DEFAULT 1,
    views         INTEGER  DEFAULT 0,
    created_at    TEXT     DEFAULT (datetime('now')),
    harvest_date  TEXT                          -- When this produce was/will be harvested
);

-- ─── TABLE 6: ORDERS ─────────────────────────────────────────────────────────
-- Records every purchase transaction on the platform.
CREATE TABLE IF NOT EXISTS orders (
    id               INTEGER  PRIMARY KEY AUTOINCREMENT,
    buyer_id         INTEGER  NOT NULL REFERENCES users(id),
    seller_id        INTEGER  NOT NULL REFERENCES users(id),
    listing_id       INTEGER  REFERENCES listings(id),
    quantity         INTEGER  NOT NULL DEFAULT 1,
    total_ugx        INTEGER  NOT NULL,
    status           TEXT     DEFAULT 'pending'
                              CHECK(status IN ('pending','confirmed','in_transit','delivered','cancelled')),
    delivery_address TEXT,
    notes            TEXT,
    order_ref        TEXT     UNIQUE,   -- Human-readable ref like 'AB-2026-123456'
    created_at       TEXT     DEFAULT (datetime('now')),
    updated_at       TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 7: CART_ITEMS ─────────────────────────────────────────────────────
-- Items a user has added to their basket but not yet checked out.
CREATE TABLE IF NOT EXISTS cart_items (
    id           INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER  NOT NULL REFERENCES users(id),
    listing_id   INTEGER  NOT NULL REFERENCES listings(id),
    quantity     INTEGER  NOT NULL DEFAULT 1,
    added_at     TEXT     DEFAULT (datetime('now')),
    UNIQUE(user_id, listing_id)   -- Each item can only appear once per cart
);

-- ─── TABLE 8: PRICES ─────────────────────────────────────────────────────────
-- Tracks market prices for crops over time.
-- New prices are added regularly to track trends.
CREATE TABLE IF NOT EXISTS prices (
    id           INTEGER  PRIMARY KEY AUTOINCREMENT,
    crop_name    TEXT     NOT NULL,
    emoji        TEXT,
    price_ugx    INTEGER  NOT NULL,
    unit         TEXT     DEFAULT 'per kg',
    district     TEXT     DEFAULT 'Kampala',
    change_pct   REAL     DEFAULT 0,    -- e.g. 5.2 means +5.2%, -3.1 means -3.1%
    trend        TEXT     DEFAULT 'stable'
                          CHECK(trend IN ('up','down','stable')),
    source       TEXT     DEFAULT 'AgriBridge',
    recorded_at  TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 9: TRAINING_MODULES ───────────────────────────────────────────────
-- The learning content in the Training Hub.
CREATE TABLE IF NOT EXISTS training_modules (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    title         TEXT     NOT NULL,
    category      TEXT     NOT NULL
                           CHECK(category IN ('crop','business','digital','postharvest','finance')),
    description   TEXT,
    content       TEXT,    -- Full lesson text (can include HTML for formatting)
    video_url     TEXT,    -- YouTube embed URL e.g. https://www.youtube.com/embed/xxxxx
    duration_min  INTEGER  DEFAULT 20,
    level         TEXT     DEFAULT 'Beginner'
                           CHECK(level IN ('Beginner','Intermediate','Advanced')),
    emoji         TEXT     DEFAULT '📚',
    is_active     INTEGER  DEFAULT 1,
    created_at    TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 10: USER_PROGRESS ─────────────────────────────────────────────────
-- Tracks which training modules each user has completed.
CREATE TABLE IF NOT EXISTS user_progress (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER  NOT NULL REFERENCES users(id),
    module_id     INTEGER  NOT NULL REFERENCES training_modules(id),
    progress_pct  INTEGER  DEFAULT 0,    -- 0-100
    completed     INTEGER  DEFAULT 0,    -- 1 = finished
    started_at    TEXT     DEFAULT (datetime('now')),
    completed_at  TEXT,
    UNIQUE(user_id, module_id)           -- One record per user per module
);

-- ─── TABLE 11: SMS_LOG ───────────────────────────────────────────────────────
-- Records every SMS sent through the platform for auditing.
CREATE TABLE IF NOT EXISTS sms_log (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    recipient   TEXT     NOT NULL,   -- Phone number
    message     TEXT     NOT NULL,
    type        TEXT,                -- 'welcome', 'order_confirm', 'price_alert', etc.
    status      TEXT     DEFAULT 'sent'
                         CHECK(status IN ('sent','failed','pending')),
    sent_at     TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 12: USSD_SESSIONS ─────────────────────────────────────────────────
-- Keeps track of active USSD sessions (what menu the user is on).
CREATE TABLE IF NOT EXISTS ussd_sessions (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT     NOT NULL UNIQUE,
    phone         TEXT     NOT NULL,
    current_menu  TEXT     DEFAULT 'home',
    session_data  TEXT,    -- JSON for storing temporary data during the session
    created_at    TEXT     DEFAULT (datetime('now')),
    updated_at    TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 13: MATCHES ───────────────────────────────────────────────────────
-- Records AI-matched connections between vendors and farmers.
CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    vendor_id   INTEGER  REFERENCES users(id),
    farmer_id   INTEGER  REFERENCES users(id),
    crop        TEXT,
    score_pct   INTEGER,   -- How strong the match is: 0-100
    status      TEXT     DEFAULT 'pending'
                         CHECK(status IN ('pending','connected','completed','rejected')),
    created_at  TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 14: REVIEWS ───────────────────────────────────────────────────────
-- Star ratings and comments left by buyers for farmers/vendors.
CREATE TABLE IF NOT EXISTS reviews (
    id           INTEGER  PRIMARY KEY AUTOINCREMENT,
    reviewer_id  INTEGER  NOT NULL REFERENCES users(id),
    reviewed_id  INTEGER  NOT NULL REFERENCES users(id),
    order_id     INTEGER  REFERENCES orders(id),
    rating       INTEGER  NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 15: CONTACTS ──────────────────────────────────────────────────────
-- Messages submitted through the contact form.
CREATE TABLE IF NOT EXISTS contacts (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    name          TEXT     NOT NULL,
    contact_info  TEXT     NOT NULL,   -- Phone or email
    role          TEXT,
    message       TEXT     NOT NULL,
    is_read       INTEGER  DEFAULT 0,
    created_at    TEXT     DEFAULT (datetime('now'))
);

-- ─── TABLE 16: DISTRICTS ─────────────────────────────────────────────────────
-- Uganda district data for the feasibility map.
CREATE TABLE IF NOT EXISTS districts (
    id              INTEGER  PRIMARY KEY AUTOINCREMENT,
    name            TEXT     NOT NULL UNIQUE,
    region          TEXT,    -- 'Central', 'Eastern', 'Western', 'Northern'
    farmer_count    INTEGER  DEFAULT 0,
    priority_score  INTEGER  DEFAULT 50,  -- 0-100 rollout priority
    phase           INTEGER  DEFAULT 3,   -- 1=now, 2=soon, 3=expansion, 4=rural
    lat             REAL,
    lng             REAL
);


-- ============================================================
--  USEFUL QUERIES FOR LEARNING AND TESTING
-- ============================================================

-- How many users of each role?
-- SELECT role, COUNT(*) as count FROM users GROUP BY role;

-- What are today's top prices?
-- SELECT crop_name, price_ugx, trend FROM prices ORDER BY price_ugx DESC;

-- Which farmer has the best rating?
-- SELECT u.name, AVG(r.rating) as avg_rating, COUNT(r.id) as reviews
-- FROM users u JOIN reviews r ON r.reviewed_id = u.id
-- WHERE u.role = 'farmer'
-- GROUP BY u.id ORDER BY avg_rating DESC;

-- What listings are currently active?
-- SELECT l.title, l.price_ugx, u.name as seller
-- FROM listings l JOIN users u ON l.seller_id = u.id
-- WHERE l.is_active = 1;

-- Show all orders and their status
-- SELECT o.order_ref, b.name as buyer, s.name as seller, l.title, o.total_ugx, o.status
-- FROM orders o
-- JOIN users b ON o.buyer_id = b.id
-- JOIN users s ON o.seller_id = s.id
-- JOIN listings l ON o.listing_id = l.id;

-- Which training modules has user 1 completed?
-- SELECT tm.title, up.progress_pct, up.completed
-- FROM user_progress up JOIN training_modules tm ON up.module_id = tm.id
-- WHERE up.user_id = 1;
