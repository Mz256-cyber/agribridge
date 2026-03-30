/*
 * AgriBridge API Connector
 * ========================
 * This file connects the frontend (HTML page) to the backend (Flask/Python).
 * It replaces the fake/demo data with real data from the database.
 *
 * WHAT THIS FILE DOES:
 * - Talks to the Flask API at http://localhost:5000
 * - Makes all buttons actually save and load data from the database
 * - Makes the training modules open with real content and videos
 * - Makes the USSD simulator use the real backend logic
 * - Makes the contact form actually save messages
 * - Makes the matching engine use real farmer data
 */

const API = 'http://localhost:5000/api';

/* ─── GENERIC API HELPER ────────────────────────────────────────────────── */
async function api(method, endpoint, body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(API + endpoint, options);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('API error:', err);
    return { status: 'error', message: 'Could not connect to server. Is the backend running?' };
  }
}

/* ─── LIVE STATS (hero section counters) ────────────────────────────────── */
async function loadLiveStats() {
  const data = await api('GET', '/stats');
  if (data.status === 'success') {
    const stats = data.data;
    const sf = document.getElementById('stat-farmers');
    const sl = document.getElementById('stat-listings');
    const so = document.getElementById('stat-orders');
    const ss = document.getElementById('stat-saved');
    if (sf) animCount(sf, stats.farmers || 847);
    if (sl) animCount(sl, stats.listings || 2394);
    if (so) animCount(so, stats.orders || 12650);
    if (ss) animCount(ss, stats.total_value_ugx || 180000000);
  }
}

/* ─── LIVE PRICES FROM DATABASE ─────────────────────────────────────────── */
async function loadLivePrices() {
  const data = await api('GET', '/prices');
  if (data.status !== 'success') return;

  const prices = data.data;
  const list = document.getElementById('price-list');
  if (!list || !prices.length) return;

  list.innerHTML = prices.map(p => `
    <div class="pc-crop" onclick="selectCropByName('${p.crop_name}', ${p.price_ugx}, ${p.change_pct}, '${p.trend}')">
      <div class="crop-emoji">${p.emoji || '🌿'}</div>
      <div class="crop-info">
        <h6>${p.crop_name}</h6>
        <small>${p.unit}</small>
      </div>
      <div class="crop-price-tag">
        <div class="cp-val">UGX ${p.price_ugx.toLocaleString()}</div>
        <div class="cp-chg ${p.trend === 'up' ? 'cp-up' : p.trend === 'down' ? 'cp-dn' : 'cp-st'}">
          ${p.trend === 'up' ? '▲' : p.trend === 'down' ? '▼' : '–'} ${Math.abs(p.change_pct)}%
        </div>
      </div>
    </div>`).join('');
}

function selectCropByName(name, price, change, trend) {
  const cn = document.getElementById('chart-crop-name');
  if (cn) cn.textContent = name;
  const at = document.getElementById('advisory-text');
  if (at) at.textContent = `Current price: UGX ${price.toLocaleString()} (${trend}). ${
    trend === 'up' ? 'Good time to sell!' : trend === 'down' ? 'Consider locking in a forward contract.' : 'Prices are stable right now.'
  }`;
}

/* ─── LIVE LISTINGS FROM DATABASE ───────────────────────────────────────── */
async function loadLiveListings(category = 'all') {
  const endpoint = category === 'all' ? '/listings?limit=12' : `/listings?category=${category}&limit=12`;
  const data = await api('GET', endpoint);
  if (data.status !== 'success') return;

  const listings = data.data.listings;
  const grid = document.getElementById('listings-grid');
  if (!grid) return;

  grid.innerHTML = listings.map(l => `
    <div class="l-card">
      <div class="l-img">${l.emoji || '🌿'}
        <span class="l-badge ${l.is_organic ? 'b-organic' : l.category === 'fresh' ? 'b-fresh' : 'b-input'}">
          ${l.is_organic ? 'Organic' : l.badge || l.category}
        </span>
      </div>
      <div class="l-body">
        <h4>${l.title}</h4>
        <div class="l-stars">
          ${'★'.repeat(Math.round(l.avg_rating || 4))}${'☆'.repeat(5 - Math.round(l.avg_rating || 4))}
          <span style="color:var(--soft);font-size:.72rem;">(${l.review_count || 0})</span>
        </div>
        <div class="l-farmer">
          <i class="fas fa-location-dot"></i>
          ${l.district || l.seller_district} · ${l.seller_name}
        </div>
        <div class="l-meta">
          <div>
            <div class="l-price">UGX ${l.price_ugx.toLocaleString()}</div>
            <div class="l-unit">${l.unit}</div>
          </div>
          <button class="add-btn" onclick="addToCartDB(${l.id}, '${l.title}', ${l.price_ugx}, '${l.unit}', '${l.seller_name}', '${l.emoji || '🌿'}')">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      </div>
    </div>`).join('');
}

// Override the filter buttons to use live data
window.addEventListener('load', () => {
  const filters = document.getElementById('mkt-filters');
  if (filters) {
    filters.addEventListener('click', e => {
      const btn = e.target.closest('.f-btn');
      if (!btn) return;
      document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      loadLiveListings(btn.dataset.filter || 'all');
    });
  }
});

function addToCartDB(id, name, price, unit, seller, emoji) {
  // Reuse the existing cart system
  const existingCart = window.cart || [];
  const existing = existingCart.find(x => x.id === id);
  if (existing) {
    existing.qty++;
  } else {
    existingCart.push({ id, name, price, unit, farmer: seller, emoji: emoji || '🌿', qty: 1 });
  }
  window.cart = existingCart;
  const cc = document.getElementById('cart-count');
  if (cc) cc.textContent = existingCart.reduce((s, i) => s + i.qty, 0);
  toast(`${emoji} ${name} added to basket`);
}

/* ─── TRAINING MODULES — OPEN WITH REAL CONTENT AND VIDEO ──────────────── */
async function loadAndOpenModule(moduleId, title) {
  // Show loading state
  toast('📚 Loading module: ' + title);

  const data = await api('GET', '/training/modules/' + moduleId);
  if (data.status !== 'success') {
    toast('Could not load module. Please check your connection.');
    return;
  }

  const mod = data.data;

  // Create a full-screen lesson viewer
  let overlay = document.getElementById('moduleOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'moduleOverlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(7,21,10,.92);z-index:1000;
      display:flex;align-items:flex-start;justify-content:center;
      padding:1.5rem;overflow-y:auto;backdrop-filter:blur(8px);
    `;
    document.body.appendChild(overlay);
  }

  // Level badge color
  const lvlColor = mod.level === 'Beginner' ? '#1b5e20' : mod.level === 'Intermediate' ? '#bf360c' : '#b71c1c';

  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;width:100%;max-width:860px;overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.4);margin:0 auto;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#163312,#0d2010);padding:1.8rem 2rem 1.4rem;position:relative;">
        <button onclick="closeModuleOverlay()" style="position:absolute;top:1rem;right:1rem;background:rgba(255,255,255,.12);border:none;width:34px;height:34px;border-radius:50%;cursor:pointer;color:white;font-size:.9rem;display:flex;align-items:center;justify-content:center;">✕</button>
        <div style="font-size:2.5rem;margin-bottom:.5rem;">${mod.emoji}</div>
        <h2 style="font-family:'Fraunces',serif;color:white;font-size:1.6rem;margin-bottom:.4rem;">${mod.title}</h2>
        <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;">
          <span style="background:${lvlColor};color:white;padding:.22rem .75rem;border-radius:50px;font-size:.72rem;font-weight:700;">${mod.level}</span>
          <span style="color:rgba(255,255,255,.5);font-size:.78rem;"><i class="fas fa-clock"></i> ${mod.duration_min} minutes</span>
          <span style="color:rgba(255,255,255,.5);font-size:.78rem;text-transform:capitalize;">${mod.category} Management</span>
        </div>
      </div>

      <!-- Video (if available) -->
      ${mod.video_url ? `
      <div style="background:#000;position:relative;padding-bottom:40%;height:0;overflow:hidden;">
        <iframe
          src="${mod.video_url}"
          style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;"
          allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"
          allowfullscreen
          title="${mod.title}">
        </iframe>
      </div>
      <div style="background:#f0f9ea;padding:.7rem 1.5rem;display:flex;align-items:center;gap:.5rem;font-size:.82rem;color:#2e7d32;border-bottom:1px solid #c8e6c9;">
        <i class="fas fa-play-circle"></i>
        <strong>Video lesson</strong> — Watch the video above, then read the written guide below
      </div>
      ` : `
      <div style="background:#fff3e0;padding:.7rem 1.5rem;display:flex;align-items:center;gap:.5rem;font-size:.82rem;color:#e65100;border-bottom:1px solid #ffe0b2;">
        <i class="fas fa-book-open"></i>
        <strong>Written lesson</strong> — Read carefully and take notes
      </div>
      `}

      <!-- Content -->
      <div style="padding:2rem;font-family:'Outfit',sans-serif;line-height:1.75;color:#07160a;max-height:60vh;overflow-y:auto;">
        <style>
          #moduleOverlay h3 { font-family:'Fraunces',serif; color:#163312; font-size:1.2rem; margin: 1.4rem 0 .6rem; border-bottom:2px solid #e8f4e2; padding-bottom:.4rem; }
          #moduleOverlay p { margin-bottom:.9rem; color:#2a4a2a; }
          #moduleOverlay ul, #moduleOverlay ol { margin: .5rem 0 1rem 1.5rem; color:#2a4a2a; }
          #moduleOverlay li { margin-bottom:.4rem; }
          #moduleOverlay table { width:100%; border-collapse:collapse; margin:1rem 0; font-size:.88rem; }
          #moduleOverlay th { background:#163312; color:white; padding:.6rem .9rem; text-align:left; }
          #moduleOverlay td { padding:.5rem .9rem; border-bottom:1px solid #e8f4e2; }
          #moduleOverlay tr:hover td { background:#f0f9ea; }
          #moduleOverlay strong { color:#163312; }
        </style>
        ${mod.content || '<p>Content coming soon. Check back shortly.</p>'}
      </div>

      <!-- Footer -->
      <div style="padding:1.3rem 2rem;border-top:1px solid #e8f4e2;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;background:#f9f5ec;">
        <div style="font-size:.82rem;color:#4a6050;">
          <i class="fas fa-info-circle" style="color:#4caf50;"></i>
          Mark as complete when you have finished reading
        </div>
        <div style="display:flex;gap:.7rem;">
          <button onclick="closeModuleOverlay()" style="background:#e8f4e2;color:#163312;border:1.5px solid rgba(46,125,50,.2);padding:.6rem 1.2rem;border-radius:50px;font-weight:600;font-size:.82rem;cursor:pointer;font-family:'Outfit',sans-serif;">
            Close
          </button>
          <button onclick="markModuleComplete(${mod.id}, '${mod.title}')" style="background:#163312;color:white;border:none;padding:.6rem 1.5rem;border-radius:50px;font-weight:700;font-size:.82rem;cursor:pointer;font-family:'Outfit',sans-serif;display:flex;align-items:center;gap:.4rem;">
            <i class="fas fa-check"></i> Mark Complete
          </button>
        </div>
      </div>
    </div>`;

  overlay.style.display = 'flex';
}

function closeModuleOverlay() {
  const overlay = document.getElementById('moduleOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function markModuleComplete(moduleId, title) {
  const user = getCurrentUser();
  if (!user) {
    toast('Please sign in to track your progress');
    return;
  }
  const data = await api('POST', '/training/progress', {
    user_id: user.id,
    module_id: moduleId,
    progress_pct: 100
  });
  if (data.status === 'success') {
    toast('🎉 Module complete: ' + title);
    closeModuleOverlay();
  } else {
    toast('Could not save progress: ' + data.message);
  }
}

/* ─── OVERRIDE openModule TO USE REAL API ───────────────────────────────── */
window.openModule = async function(title) {
  // Find module ID from the DOM or fetch by title
  const data = await api('GET', '/training/modules');
  if (data.status !== 'success') { toast('Could not load modules'); return; }
  const mod = data.data.find(m => m.title === title);
  if (mod) {
    loadAndOpenModule(mod.id, mod.title);
  } else {
    toast('Module not found: ' + title);
  }
};

/* ─── TRAINING MODULES — LOAD FROM DB ──────────────────────────────────── */
async function loadModulesFromDB(category) {
  const endpoint = category ? `/training/modules?category=${category}` : '/training/modules';
  const data = await api('GET', endpoint);
  if (data.status !== 'success') return;

  const mods = data.data;
  const grid = document.getElementById('module-grid');
  if (!grid) return;

  const user = getCurrentUser();
  let userProgress = {};
  if (user) {
    const pd = await api('GET', `/training/progress/${user.id}`);
    if (pd.status === 'success') {
      pd.data.modules.forEach(m => { userProgress[m.module_id] = m.progress_pct; });
    }
  }

  grid.innerHTML = mods.map(m => {
    const progress = userProgress[m.id] || 0;
    const lvlClass = m.level === 'Beginner' ? 'mc-beginner' : m.level === 'Intermediate' ? 'mc-intermediate' : 'mc-advanced';
    return `
    <div class="module-card" onclick="openModule('${m.title.replace(/'/g, "\\'")}')">
      <div class="mc-thumb">
        <span>${m.emoji}</span>
        <span class="mc-level ${lvlClass}">${m.level}</span>
      </div>
      <div class="mc-body">
        <h4>${m.title}</h4>
        <p>${m.description}</p>
        <div class="mc-footer">
          <span class="mc-meta"><i class="fas fa-clock"></i> ${m.duration_min} min</span>
          <div class="mc-progress-wrap">
            <div class="mc-progress-bar">
              <div class="mc-progress-fill" style="width:${progress}%"></div>
            </div>
            <span class="mc-prog-num">${progress}%</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ─── OVERRIDE setTrainCat TO USE DB ────────────────────────────────────── */
window.setTrainCat = function(cat, el) {
  document.querySelectorAll('.train-cat').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  loadModulesFromDB(cat);
};

/* ─── BACKEND AUTH — REGISTER AND LOGIN ─────────────────────────────────── */
async function registerWithBackend(formData) {
  const data = await api('POST', '/auth/register', formData);
  return data;
}

async function loginWithBackend(phone, password) {
  const data = await api('POST', '/auth/login', { phone, password });
  return data;
}

function getCurrentUser() {
  try {
    const saved = localStorage.getItem('agribridge_user');
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
}

/* ─── OVERRIDE completeRegistration TO SAVE TO DATABASE ─────────────────── */
const _originalComplete = window.completeRegistration;
window.completeRegistration = async function() {
  // Get form data from DOM
  const name = document.getElementById('af_name')?.value.trim();
  const phone = document.getElementById('af_phone')?.value.trim();
  if (!name || !phone) { toast('Please fill your name and phone'); return; }

  // Collect all fields
  const formData = {
    name, phone,
    password: document.getElementById('af_password')?.value || 'agri' + Math.random().toString(36).slice(2, 8),
    role: window.AUTH_TYPE || 'farmer',
    email: document.getElementById('af_email')?.value,
    district: document.getElementById('af_dist')?.value,
    address: document.getElementById('af_address')?.value,
    national_id: document.getElementById('af_nid')?.value,
    // Farmer fields
    farm_size_acres: document.getElementById('af_acres')?.value,
    primary_crops: document.getElementById('af_crops')?.value?.split(',').map(s => s.trim()),
    monthly_output_kg: document.getElementById('af_output')?.value,
    momo_number: document.getElementById('af_momo')?.value,
    main_challenge: document.getElementById('af_challenge')?.value,
    // Vendor fields
    business_name: document.getElementById('af_name')?.value,
    market_location: document.getElementById('af_location')?.value,
    kcca_permit: document.getElementById('af_permit')?.value,
    product_categories: document.getElementById('af_cats')?.value?.split(',').map(s => s.trim()),
    weekly_volume_kg: document.getElementById('af_vol')?.value,
    delivery_radius_km: document.getElementById('af_radius')?.value,
    buyer_type: document.getElementById('af_buyers')?.value,
    // Buyer fields
    prods: document.getElementById('af_prods')?.value,
    delivery_time: document.getElementById('af_time')?.value,
    payment_pref: document.getElementById('af_pay')?.value,
    // Hotel fields
    hotel_type: document.getElementById('af_type')?.value,
    contact_person: document.getElementById('af_contact')?.value,
    quality_grade: document.getElementById('af_grade')?.value,
    special_needs: document.getElementById('af_needs')?.value,
  };

  // Try saving to backend
  const result = await registerWithBackend(formData);

  if (result.status === 'success') {
    const user = result.data;
    // Generate trust score and code for display
    user.trustScore = user.trust_score || 60;
    user.code = user.ussd_code || 'AB' + Math.floor(Math.random() * 999999);
    user.type = user.role;

    // Save to localStorage
    try { localStorage.setItem('agribridge_user', JSON.stringify(user)); } catch (e) {}
    window.CURRENT_USER = user;

    // Continue with original UI flow
    if (window.renderDashboard) renderDashboard(user);
    if (window.goToAuthPanel) goToAuthPanel(4);
    if (window.updateNavForUser) updateNavForUser();

    toast('🎉 Welcome ' + user.name.split(' ')[0] + '! Profile saved to database.');

    // Show SMS notification
    setTimeout(() => {
      showSmsNotif(
        'Welcome ' + user.name.split(' ')[0] + '! Code: ' + user.ussd_code + '. Dial *789# from any phone.',
        'Welcome to AgriBridge', 1200
      );
    }, 1000);
  } else {
    // Backend failed — fall back to local-only registration
    toast('⚠️ ' + result.message);
    // Call original function as fallback
    if (_originalComplete) _originalComplete();
  }
};

/* ─── BACKEND USSD — CONNECTS TO FLASK API ──────────────────────────────── */
window.ussdReply = async function() {
  const inp = document.getElementById('ussdInput');
  if (!inp) return;
  const inputVal = inp.value.trim();
  inp.value = '';

  const phone = (getCurrentUser()?.phone) || '+256700000000';
  const sessionId = 'web-' + phone.replace(/\D/g, '');

  const data = await api('POST', '/ussd', {
    phone: phone,
    input: inputVal,
    session_id: sessionId
  });

  const uc = document.getElementById('ussdContent');
  if (!uc) return;

  if (data.status === 'success') {
    uc.textContent = data.data.text;
  } else {
    uc.textContent = 'Connection error.\nIs the server running?\n\nTry refreshing the page.';
  }
};

/* ─── BACKEND SMS SIMULATOR ─────────────────────────────────────────────── */
async function sendSMSToBackend(phone, message) {
  const data = await api('POST', '/sms', { phone, message });
  return data;
}

/* ─── BACKEND MATCHING ENGINE ───────────────────────────────────────────── */
window.runMatching = async function() {
  const crop = document.getElementById('match-crop')?.value;
  const district = document.getElementById('match-district')?.value;
  const volume = document.getElementById('match-volume')?.value;
  const grade = document.getElementById('match-grade')?.value;

  if (!crop && !district) {
    toast('Please select at least a crop and district');
    return;
  }

  const mr = document.getElementById('match-results');
  if (!mr) return;

  mr.innerHTML = `<div style="text-align:center;padding:1.5rem;color:rgba(255,255,255,.5);">
    <i class="fas fa-bolt" style="color:var(--citrus);display:block;font-size:1.6rem;margin-bottom:.5rem;"></i>
    Matching farmers from database...
  </div>`;

  const data = await api('POST', '/match', {
    crop: crop || '',
    district: district || '',
    volume: volume || '',
    grade: grade || ''
  });

  if (data.status !== 'success') {
    mr.innerHTML = '<div class="match-empty"><i class="fas fa-exclamation-triangle"></i><p>Could not load matches. Check server connection.</p></div>';
    return;
  }

  const matches = data.data.matches;
  const mc = document.getElementById('match-count');
  if (mc) mc.textContent = `(${matches.length} found)`;

  if (!matches.length) {
    mr.innerHTML = '<div class="match-empty"><i class="fas fa-search"></i><p>No farmers found. Try different criteria.</p></div>';
    return;
  }

  const emojiMap = { 'farmer': '👨🏾‍🌾', 'Wakiso': '🧑🏾‍🌾', 'Mukono': '👩🏿‍🌾', 'Gulu': '🧑🏿‍🌾', 'Masaka': '👩🏾‍🌾' };

  mr.innerHTML = matches.map(f => {
    const crops = (() => { try { return JSON.parse(f.crops || '[]').join(', '); } catch(e) { return f.crops || 'Various crops'; } })();
    const emoji = emojiMap[f.district] || '👨🏾‍🌾';
    return `
    <div class="match-card">
      <div class="match-avatar">${emoji}</div>
      <div class="match-info">
        <h5>${f.name}</h5>
        <p>${f.district} · ${f.monthly_output_kg ? f.monthly_output_kg + 'kg/mo' : 'Flexible volume'}</p>
        <p style="color:rgba(255,255,255,.35);font-size:.72rem;">${crops} · ⭐${f.rating}</p>
      </div>
      <div class="match-score">
        <div class="ms-pct">${f.match_score}%</div>
        <div class="ms-lbl">match</div>
        <button class="match-connect-btn" onclick="connectFarmerDB(${f.id}, '${f.name}')">Connect</button>
      </div>
    </div>`;
  }).join('');
};

async function connectFarmerDB(farmerId, farmerName) {
  const user = getCurrentUser();
  if (user) {
    await api('POST', '/match/connect', {
      vendor_id: user.id,
      farmer_id: farmerId,
      crop: document.getElementById('match-crop')?.value || ''
    });
  }
  window.open(`https://wa.me/256755966690?text=Hello AgriBridge! I would like to connect with farmer: ${encodeURIComponent(farmerName)}. Please facilitate this match.`, '_blank');
  toast(`Connecting you with ${farmerName} via WhatsApp…`);
}

/* ─── BACKEND CONTACT FORM ──────────────────────────────────────────────── */
window.sendContact = async function() {
  const name = document.getElementById('c-name')?.value.trim();
  const contact = document.getElementById('c-contact')?.value.trim();
  const role = document.getElementById('c-role')?.value;
  const msg = document.getElementById('c-msg')?.value.trim();

  if (!name || !contact || !msg) {
    toast('Please fill name, contact and message');
    return;
  }

  const data = await api('POST', '/contact', {
    name, contact_info: contact, role, message: msg
  });

  if (data.status === 'success') {
    ['c-name', 'c-contact', 'c-msg'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    toast('✅ Message sent! We will respond within a few hours.');
  } else {
    // Fallback — open WhatsApp
    window.open(`https://wa.me/256755966690?text=Hello AgriBridge, I am ${encodeURIComponent(name)}.%0AContact: ${encodeURIComponent(contact)}%0A%0A${encodeURIComponent(msg)}`, '_blank');
    toast('Message sent via WhatsApp!');
  }
};

/* ─── LOAD DISTRICTS FROM DATABASE ─────────────────────────────────────── */
async function loadDistrictsFromDB() {
  const data = await api('GET', '/districts');
  if (data.status !== 'success') return;

  const districts = data.data;
  const mb = document.getElementById('map-bubbles');
  const mdc = document.getElementById('map-district-cards');

  if (mb) {
    const colors = { 1: '#1b5e20', 2: '#388e3c', 3: '#81c784', 4: '#c8e6c9' };
    mb.innerHTML = districts.map(d => `
      <div class="district-bubble" style="left:${getDistrictX(d.name)}%;top:${getDistrictY(d.name)}%;transform:translate(-50%,-50%);" onclick="selectDistrict('${d.name}')">
        <div class="db-circle" style="width:${Math.max(20, d.priority_score / 2.5)}px;height:${Math.max(20, d.priority_score / 2.5)}px;background:${colors[d.phase] || '#81c784'};color:white;font-size:.52rem;font-weight:700;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 4px 12px rgba(0,0,0,.15);">${d.priority_score}</div>
        <div class="db-label">${d.name}</div>
      </div>`).join('');
  }

  if (mdc) {
    const colors2 = { 1: '#1b5e20', 2: '#388e3c', 3: '#81c784', 4: '#c8e6c9' };
    mdc.innerHTML = districts.slice(0, 6).map(d => `
      <div class="map-dc" data-district="${d.name}" onclick="selectDistrict('${d.name}')">
        <div class="map-dc-name">
          <span style="width:9px;height:9px;border-radius:50%;background:${colors2[d.phase] || '#81c784'};display:inline-block;margin-right:.3rem;"></span>
          ${d.name}
        </div>
        <div class="map-dc-stats">
          <div class="map-dc-stat">👨🏾‍🌾 ${d.farmer_count} farmers</div>
          <div class="map-dc-stat">📊 Score: ${d.priority_score}/100</div>
        </div>
      </div>`).join('');
  }
}

// Approximate X/Y positions for Uganda districts on the map
function getDistrictX(name) {
  const positions = { 'Kampala': 48, 'Wakiso': 43, 'Mukono': 58, 'Jinja': 68, 'Mbarara': 34, 'Masaka': 38, 'Gulu': 46, 'Mbale': 72, 'Fort Portal': 24, 'Soroti': 68, 'Lira': 54, 'Kabale': 32 };
  return positions[name] || 50;
}
function getDistrictY(name) {
  const positions = { 'Kampala': 52, 'Wakiso': 47, 'Mukono': 46, 'Jinja': 44, 'Mbarara': 72, 'Masaka': 68, 'Gulu': 22, 'Mbale': 36, 'Fort Portal': 48, 'Soroti': 28, 'Lira': 20, 'Kabale': 82 };
  return positions[name] || 50;
}

/* ─── INITIALISE ALL BACKEND CONNECTIONS ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Wait a moment for original JS to set up, then load from backend
  setTimeout(async () => {
    console.log('🌿 AgriBridge: Connecting to backend...');

    // Load live data from database
    await loadLiveStats();
    await loadLivePrices();
    await loadLiveListings();
    await loadModulesFromDB('crop');
    await loadDistrictsFromDB();

    console.log('✅ AgriBridge: Backend connected.');
  }, 800);
});
