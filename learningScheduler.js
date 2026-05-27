// bot/learning/learningScheduler.js — Autonomous Learning Scheduler v1
// ═══════════════════════════════════════════════════════════════════════
// Runs background tasks that keep Zearn getting smarter automatically:
//
//  🕑 Every 6 hours:   Crawl trusted Uganda education websites
//  🕗 Every morning:   Send owner a learning digest
//  📅 Every Sunday:    Deep crawl + knowledge gap analysis
//  🧹 Every midnight:  Clean up low-quality auto-learned entries
//  ⚡ Real-time:        Learn from every good AI answer + owner reply
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const { getDb }               = require('../mongoClient');
const { autonomousLearn,
        learnFromOwnerReply,
        getWeeklyLearningReport,
        getTrainingStats }    = require('../agents/trainerAgent');
const { ingestUrl }           = require('../knowledgeIngestor');

const DB_NAME = process.env.DB_NAME || 'zearnbot';

// ─── Trusted Uganda education sources to auto-crawl ──────────────────────────
const CRAWL_SOURCES = [
  { url: 'https://www.jab.go.ug',              topic: 'JAB Uganda admission',         priority: 'high',   intervalHours: 24 },
  { url: 'https://admissions.mak.ac.ug',       topic: 'Makerere University admissions', priority: 'high', intervalHours: 24 },
  { url: 'https://www.uneb.ac.ug',             topic: 'UNEB Uganda examinations',      priority: 'high',  intervalHours: 24 },
  { url: 'https://www.kyu.ac.ug',              topic: 'Kyambogo University',            priority: 'medium', intervalHours: 72 },
  { url: 'https://www.mubs.ac.ug',             topic: 'MUBS Business School',           priority: 'medium', intervalHours: 72 },
  { url: 'https://www.must.ac.ug',             topic: 'Mbarara University MUST',        priority: 'medium', intervalHours: 72 },
  { url: 'https://www.education.go.ug',        topic: 'Uganda Ministry of Education',   priority: 'medium', intervalHours: 72 },
  { url: 'https://hesfb.go.ug',               topic: 'HESFB student loans Uganda',     priority: 'low',    intervalHours: 168 },
  { url: 'https://www.nche.ac.ug',            topic: 'NCHE university accreditation',  priority: 'low',    intervalHours: 168 },
  { url: 'https://www.chevening.org',          topic: 'Chevening UK scholarship',       priority: 'low',    intervalHours: 168 },
  { url: 'https://www.daad.de/en',             topic: 'DAAD Germany scholarship',       priority: 'low',    intervalHours: 168 },
  { url: 'https://campuschina.org',            topic: 'Chinese government scholarship', priority: 'low',    intervalHours: 168 },
];

// ─── State ────────────────────────────────────────────────────────────────────
let _schedulerRunning = false;
let _intervals        = [];
let _lastCrawlTimes   = {}; // url → timestamp

// ─── Start the scheduler ──────────────────────────────────────────────────────
function startScheduler(sock, ownerJid) {
  if (_schedulerRunning) {
    console.log('[LearningScheduler] Already running — skipping duplicate start');
    return;
  }
  _schedulerRunning = true;
  console.log('[LearningScheduler] 🚀 Starting autonomous learning scheduler');

  // ── Every 6 hours: crawl high-priority sources ────────────────────────────
  const crawlInterval = setInterval(async () => {
    console.log('[LearningScheduler] ⏰ Running scheduled crawl (6h)');
    await runCrawlCycle('high', sock, ownerJid);
  }, 6 * 60 * 60 * 1000);
  _intervals.push(crawlInterval);
  if (crawlInterval.unref) crawlInterval.unref();

  // ── Every 24 hours: crawl medium-priority sources ─────────────────────────
  const medCrawlInterval = setInterval(async () => {
    console.log('[LearningScheduler] ⏰ Running medium crawl (24h)');
    await runCrawlCycle('medium', sock, ownerJid);
  }, 24 * 60 * 60 * 1000);
  _intervals.push(medCrawlInterval);
  if (medCrawlInterval.unref) medCrawlInterval.unref();

  // ── Every Sunday at 8am Uganda: deep crawl + weekly report ───────────────
  const sundayInterval = setInterval(async () => {
    const now    = new Date(Date.now() + 3 * 60 * 60 * 1000); // UTC+3
    const issunday = now.getUTCDay() === 0;
    const is8am    = now.getUTCHours() === 8 && now.getUTCMinutes() < 2;
    if (!issunday || !is8am) return;

    console.log('[LearningScheduler] 📅 Sunday deep crawl + knowledge report');
    await runCrawlCycle('all', sock, ownerJid);

    if (sock && ownerJid) {
      const report = await getWeeklyLearningReport().catch(e => `Report error: ${e.message}`);
      sock.sendMessage(ownerJid, { text: report }).catch(() => {});
    }
  }, 60 * 1000); // check every minute
  _intervals.push(sundayInterval);
  if (sundayInterval.unref) sundayInterval.unref();

  // ── Every midnight: clean up low-quality pending entries ──────────────────
  const cleanupInterval = setInterval(async () => {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    if (now.getUTCHours() === 0 && now.getUTCMinutes() < 2) {
      await cleanupLowQualityEntries();
    }
  }, 60 * 1000);
  _intervals.push(cleanupInterval);
  if (cleanupInterval.unref) cleanupInterval.unref();

  // ── Initial crawl on startup (high priority only, 30s delay) ─────────────
  setTimeout(async () => {
    console.log('[LearningScheduler] 🌐 Initial startup crawl');
    await runCrawlCycle('high', sock, ownerJid);
  }, 30 * 1000);

  console.log('[LearningScheduler] ✅ All learning tasks scheduled');
}

// ─── Stop the scheduler ───────────────────────────────────────────────────────
function stopScheduler() {
  _intervals.forEach(i => clearInterval(i));
  _intervals        = [];
  _schedulerRunning = false;
  console.log('[LearningScheduler] Stopped');
}

// ─── Crawl cycle ─────────────────────────────────────────────────────────────
async function runCrawlCycle(priority = 'high', sock, ownerJid) {
  const sources = priority === 'all'
    ? CRAWL_SOURCES
    : CRAWL_SOURCES.filter(s => s.priority === priority);

  let totalSaved  = 0;
  let totalCrawled = 0;
  const errors    = [];

  for (const source of sources) {
    // Skip if crawled recently
    const lastCrawled = _lastCrawlTimes[source.url] || 0;
    const ageHours    = (Date.now() - lastCrawled) / (1000 * 60 * 60);
    if (ageHours < source.intervalHours) {
      console.log(`[LearningScheduler] Skipping ${source.url} (crawled ${ageHours.toFixed(1)}h ago)`);
      continue;
    }

    try {
      console.log(`[LearningScheduler] 🌐 Crawling: ${source.url}`);
      const result = await ingestUrl(source.url, source.topic);
      _lastCrawlTimes[source.url] = Date.now();
      totalSaved   += result.saved;
      totalCrawled += 1;

      if (result.saved > 0) {
        console.log(`[LearningScheduler] ✅ ${source.url}: saved ${result.saved} chunks`);
      }

      // Persist crawl state to DB
      await saveCrawlState(source.url, result.saved).catch(() => {});

      // Polite delay between requests
      await sleep(3000 + Math.random() * 2000);
    } catch (e) {
      errors.push(`${source.url}: ${e.message}`);
      console.log(`[LearningScheduler] ❌ ${source.url}: ${e.message}`);
    }
  }

  // Notify owner if significant new learning happened
  if (sock && ownerJid && totalSaved > 10) {
    const msg =
      `🧠 *Auto-Learning Update*\n\n` +
      `I just crawled ${totalCrawled} education website(s) and learned *${totalSaved} new things!*\n\n` +
      `_Go to /dashboard → Knowledge Base to review new entries._\n` +
      `Type *TRAIN: STATS* to see full training stats.`;
    sock.sendMessage(ownerJid, { text: msg }).catch(() => {});
  }

  return { crawled: totalCrawled, saved: totalSaved, errors };
}

// ─── Knowledge gap analysis ───────────────────────────────────────────────────
// Finds questions the bot answered with low confidence — areas to improve
async function analyzeKnowledgeGaps() {
  const db = await getDb(DB_NAME);

  // Find recent AI answers that contained uncertainty phrases
  const gaps = await db.collection('knowledgeGaps')
    .find({})
    .sort({ count: -1, lastSeen: -1 })
    .limit(20)
    .toArray();

  if (gaps.length === 0) return null;

  const msg =
    `🔍 *Knowledge Gap Analysis*\n\n` +
    `These are questions I've been uncertain about:\n\n` +
    gaps.slice(0, 10).map((g, i) =>
      `${i + 1}. (${g.count}x asked)\n   _"${(g.question || g.sample || '').slice(0, 70)}"_`
    ).join('\n\n') +
    `\n\n💡 Use *TRAIN: your answer here* to teach me these!`;

  return msg;
}

// ─── Save a knowledge gap ─────────────────────────────────────────────────────
async function saveKnowledgeGap(question, userId) {
  if (!question || question.length < 5) return;
  const db = await getDb(DB_NAME);
  await db.collection('knowledgeGaps').updateOne(
    { question: question.slice(0, 150) },
    {
      $inc:  { count: 1 },
      $set:  { lastSeen: new Date(), userId },
      $setOnInsert: { question: question.slice(0, 150), firstSeen: new Date(), sample: question.slice(0, 200) }
    },
    { upsert: true }
  ).catch(() => {});
}

// ─── Clean up low-quality entries ─────────────────────────────────────────────
async function cleanupLowQualityEntries() {
  const db      = await getDb(DB_NAME);
  const cutoff  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days old

  // Remove unverified auto-learned entries that are 30+ days old and never been used
  const r = await db.collection('knowledge').deleteMany({
    verified:  false,
    addedBy:   'auto',
    createdAt: { $lt: cutoff },
    hits:      { $lte: 0 },
  }).catch(() => ({ deletedCount: 0 }));

  if (r.deletedCount > 0) {
    console.log(`[LearningScheduler] 🧹 Cleaned up ${r.deletedCount} stale unverified entries`);
  }
}

// ─── Persist crawl state to MongoDB ──────────────────────────────────────────
async function saveCrawlState(url, savedCount) {
  const db = await getDb(DB_NAME);
  await db.collection('crawlState').updateOne(
    { url },
    { $set: { url, lastCrawled: new Date(), savedCount } },
    { upsert: true }
  );
}

// ─── Restore crawl state from MongoDB (on restart) ───────────────────────────
async function restoreCrawlState() {
  try {
    const db    = await getDb(DB_NAME);
    const state = await db.collection('crawlState').find({}).toArray();
    for (const s of state) {
      _lastCrawlTimes[s.url] = s.lastCrawled ? new Date(s.lastCrawled).getTime() : 0;
    }
    console.log(`[LearningScheduler] Restored crawl state for ${state.length} sources`);
  } catch (e) {
    console.log('[LearningScheduler] Could not restore crawl state:', e.message);
  }
}

// ─── Manual trigger (owner command !crawl) ────────────────────────────────────
async function runManualCrawl(filter = null) {
  const sources = filter
    ? CRAWL_SOURCES.filter(s => s.url.includes(filter) || s.topic.toLowerCase().includes(filter.toLowerCase()))
    : CRAWL_SOURCES.filter(s => s.priority === 'high');

  if (sources.length === 0) {
    return `❌ No sources match "${filter}". Available: ${CRAWL_SOURCES.map(s => s.url.replace(/https?:\/\/www?\./, '')).join(', ')}`;
  }

  // Force crawl (ignore lastCrawledTime for manual runs)
  for (const s of sources) {
    _lastCrawlTimes[s.url] = 0;
  }

  const result = await runCrawlCycle(filter ? 'all' : 'high');

  return (
    `🌐 *Manual Crawl Complete!*\n\n` +
    `• Sites crawled: ${result.crawled}\n` +
    `• New knowledge chunks saved: ${result.saved}\n` +
    `${result.errors.length > 0 ? `• Errors: ${result.errors.length}\n` : ''}` +
    `\n_Go to /dashboard → Knowledge Base to review new entries._\n` +
    `Type *TRAIN: STATS* for full training stats.`
  );
}

// ─── Get scheduler status ─────────────────────────────────────────────────────
async function getSchedulerStatus() {
  const db = await getDb(DB_NAME);

  const crawlState = await db.collection('crawlState').find({}).toArray().catch(() => []);
  const stateMap   = {};
  crawlState.forEach(s => { stateMap[s.url] = s; });

  const lines = CRAWL_SOURCES.map(s => {
    const state  = stateMap[s.url];
    const last   = state?.lastCrawled
      ? new Date(state.lastCrawled).toLocaleDateString('en-UG')
      : 'Never';
    const icon   = s.priority === 'high' ? '🔴' : s.priority === 'medium' ? '🟡' : '⚪';
    const domain = s.url.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
    return `${icon} *${domain}*\n   Last: ${last} | Saved: ${state?.savedCount || 0} chunks`;
  });

  return (
    `🌐 *Auto-Crawl Scheduler Status*\n` +
    `Running: ${_schedulerRunning ? '✅ Active' : '❌ Stopped'}\n\n` +
    lines.join('\n\n') +
    `\n\n💡 Type *!crawl* to trigger a manual crawl now.`
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  startScheduler,
  stopScheduler,
  runCrawlCycle,
  runManualCrawl,
  analyzeKnowledgeGaps,
  saveKnowledgeGap,
  cleanupLowQualityEntries,
  getSchedulerStatus,
  restoreCrawlState,
  CRAWL_SOURCES,
};
