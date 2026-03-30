# AgriBridge — Complete Setup Guide
## Uganda's Farm-to-Table Intelligence Platform

---

## What's In This Project

```
agribridge_backend/
│
├── app.py              ← The Flask backend (Python server + API)
├── schema.sql          ← All SQL table definitions (study this!)
├── agribridge.db       ← The SQLite database (created automatically)
├── run.sh              ← One-click start script
│
└── static/
    ├── index.html      ← The main website (frontend)
    └── api_connector.js ← Connects buttons to the backend
```

---

## How to Run (Step by Step)

### Step 1: Make sure Python is installed
```bash
python3 --version
```
You should see something like: `Python 3.10.x`

### Step 2: Make sure Flask is installed
```bash
pip3 install flask
```

### Step 3: Go into the project folder
```bash
cd agribridge_backend
```

### Step 4: Start the server
```bash
python3 app.py
```

You will see:
```
✅ Database tables created.
🌱 Seeding database with sample data...
✅ Server ready!
📡 API running at: http://localhost:5000
```

### Step 5: Open the website
Open your browser and go to:
```
http://localhost:5000
```

That's it! The full platform should be running.

---

## Understanding the Code (For Learners)

### What is Flask?
Flask is a Python framework for building web servers.
It receives requests from the browser and sends back responses.

### What is SQLite?
SQLite is a simple database that stores data in a single file (`agribridge.db`).
You can open it with any SQLite browser to see all the data.

### What is an API?
API = Application Programming Interface.
It's a set of URLs that the website can call to get or save data.

For example:
- `GET /api/listings` → returns all products for sale
- `POST /api/orders` → creates a new order
- `POST /api/ussd` → handles a USSD menu interaction

---

## API Endpoints (All Available Routes)

### Authentication
| Method | URL | What it does |
|--------|-----|--------------|
| POST | /api/auth/register | Register a new user |
| POST | /api/auth/login | Login with phone + password |
| GET | /api/users/{id} | Get a user's profile |

### Marketplace
| Method | URL | What it does |
|--------|-----|--------------|
| GET | /api/listings | Get all products |
| GET | /api/listings?category=fresh | Filter by category |
| GET | /api/listings?search=tomato | Search products |
| POST | /api/listings | Create a new listing |
| DELETE | /api/listings/{id} | Remove a listing |

### Orders
| Method | URL | What it does |
|--------|-----|--------------|
| POST | /api/orders | Place a new order |
| GET | /api/orders/{user_id} | Get orders for a user |
| PUT | /api/orders/{ref}/status | Update order status |

### Prices
| Method | URL | What it does |
|--------|-----|--------------|
| GET | /api/prices | Get all crop prices |
| POST | /api/prices | Add a new price record |

### Training
| Method | URL | What it does |
|--------|-----|--------------|
| GET | /api/training/modules | Get all modules |
| GET | /api/training/modules?category=crop | Filter by category |
| GET | /api/training/modules/{id} | Get full module content |
| POST | /api/training/progress | Save user progress |
| GET | /api/training/progress/{user_id} | Get user's progress |

### USSD Simulator
| Method | URL | What it does |
|--------|-----|--------------|
| POST | /api/ussd | Process a USSD input |

### SMS Simulator
| Method | URL | What it does |
|--------|-----|--------------|
| POST | /api/sms | Process an SMS command |

### Matching Engine
| Method | URL | What it does |
|--------|-----|--------------|
| POST | /api/match | Find matching farmers |
| POST | /api/match/connect | Record a connection |

### Other
| Method | URL | What it does |
|--------|-----|--------------|
| POST | /api/contact | Submit contact form |
| GET | /api/districts | Get district map data |
| POST | /api/reviews | Leave a review |
| GET | /api/stats | Get platform statistics |
| GET | /api/search?q=tomato | Search everything |

---

## How to Test the API (Without the Website)

You can test any API endpoint using curl in the terminal:

```bash
# Get all prices
curl http://localhost:5000/api/prices

# Get all listings
curl http://localhost:5000/api/listings

# Register a new user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Farmer","phone":"+256700000099","role":"farmer","district":"Wakiso"}'

# Test USSD (pressing '1' from home menu)
curl -X POST http://localhost:5000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"phone":"+256700000099","input":"1","session_id":"test123"}'

# Test SMS
curl -X POST http://localhost:5000/api/sms \
  -H "Content-Type: application/json" \
  -d '{"phone":"+256700000099","message":"PRICES"}'
```

---

## The Database Tables

Open `agribridge.db` with SQLite Browser to see all data visually.

Or run queries in the terminal:
```bash
sqlite3 agribridge.db

# Inside sqlite3:
.tables                  -- see all tables
SELECT * FROM users;     -- see all users
SELECT * FROM listings;  -- see all products
.quit                    -- exit
```

---

## Default Test Accounts

| Name | Phone | Password | Role |
|------|-------|----------|------|
| Nakato Sarah | +256772100001 | pass123 | Farmer |
| Ssemakula John | +256772100002 | pass123 | Vendor |
| Grace Apio | +256772100003 | pass123 | Buyer |
| Pearl Hotel | +256772100004 | pass123 | Hotel |
| Admin | +256700000000 | admin2026 | Admin |

---

## SMS Commands to Test

Send these to the SMS simulator (or /api/sms endpoint):
- `PRICES` — get all crop prices
- `PRICES TOMATOES` — get tomato price only
- `WEATHER KAMPALA` — get weather advisory
- `LIST TOMATOES 200 7500` — list produce for sale
- `ORDERS` — see your orders
- `AGENT` — find nearest agent
- `HELP` — see all commands
- `JOIN Sarah Wakiso` — register via SMS

---

## USSD Menu Tree (*789#)

```
Home Menu
├── 1. Check Prices → Shows all crop prices from database
├── 2. List My Produce → Enter CROP,KG,PRICE to list
├── 3. My Orders → Shows real orders from database
├── 4. Weather & Advisory → Today's farming advice
├── 5. Talk to Agent → Nearest agent contact
└── 6. My Account → Shows your profile data
```

---

## Adding Your Own Video to Training Modules

To add a real YouTube video to a training module:

1. Find a YouTube video about farming (e.g., tomato planting in Uganda)
2. Get the video ID from the URL (e.g., `dQw4w9WgXcQ` from `youtube.com/watch?v=dQw4w9WgXcQ`)
3. Open `agribridge.db` in SQLite Browser
4. Find the module in `training_modules` table
5. Update `video_url` to: `https://www.youtube.com/embed/YOUR_VIDEO_ID`

Or run this SQL:
```sql
UPDATE training_modules
SET video_url = 'https://www.youtube.com/embed/YOUR_VIDEO_ID'
WHERE title = 'Soil Preparation & Planting';
```

---

## Contact & Support

Platform: AgriBridge
WhatsApp: +256 755 966 690
Email: info@agribridge.ug
Location: Kampala, Uganda

© 2026 AgriBridge · Uganda Farm Intelligence Platform
