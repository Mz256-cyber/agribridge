// bot/agents/trainerAgent.js — Autonomous Learning & Training Agent v1
// ═══════════════════════════════════════════════════════════════════
// TRAINING COMMANDS (owner-only, password protected):
//
//   TRAIN: new fact to remember
//   TRAIN: FORGET: old fact that is wrong
//   TRAIN: LIST
//   TRAIN: URL: https://jab.go.ug
//   TRAIN: FILE: (send a PDF/DOCX with this caption)
//   TRAIN: STATS
//   TRAIN: APPROVE: <id>   — approve a pending auto-learned entry
//   TRAIN: REJECT: <id>    — reject a bad auto-learned entry
//   TRAIN: CORRECT: <old answer> | <correct answer>
//
// AUTONOMOUS LEARNING (no commands needed):
//   - Bot automatically learns from every confident AI answer
//   - Bot automatically learns from owner's manual replies
//   - Bot monitors web sources weekly for updates
//   - Owner gets a daily digest of what the bot learned
// ═══════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const { getDb }         = require('../mongoClient');
const { ingestUrl, ingestDocument, ingestText, searchKnowledge } = require('../knowledgeIngestor');

const DB_NAME       = process.env.DB_NAME       || 'zearnbot';
const TRAIN_PASSWORD = process.env.TRAIN_PASSWORD || process.env.ADMIN_PASSWORD || 'zearn2025';

// ─── Handle a TRAIN: command ──────────────────────────────────────────────────
async function handle(text, userId, options = {}) {
  const { isOwner } = options;

  // Parse: TRAIN: [password:] command
  const rawCmd = text.replace(/^train:\s*/i, '').trim();

  // Password check — extract if present
  let cmd      = rawCmd;
  let authed   = isOwner; // owner is always authed

  if (!authed) {
    // Format: TRAIN: password: actual command
    const pwdMatch = rawCmd.match(/^([^:]+):\s*(.+)$/s);
    if (pwdMatch && pwdMatch[1].trim() === TRAIN_PASSWORD) {
      authed = true;
      cmd    = pwdMatch[2].trim();
    } else {
      return `🔒 Training requires authentication.\n\nFormat: *TRAIN: ${TRAIN_PASSWORD}: your fact here*\n\nOr contact the admin.`;
    }
  }

  const cmdLower = cmd.toLowerCase().trim();

  // ── TRAIN: LIST ─────────────────────────────────────────────────────────────
  if (cmdLower === 'list') return await listTrainedFacts();

  // ── TRAIN: STATS ────────────────────────────────────────────────────────────
  if (cmdLower === 'stats') return await getTrainingStats();

  // ── TRAIN: FORGET: <fact> ───────────────────────────────────────────────────
  if (/^forget:/i.test(cmd)) {
    const toForget = cmd.replace(/^forget:\s*/i, '').trim();
    return await forgetFact(toForget);
  }

  // ── TRAIN: URL: <url> ────────────────────────────────────────────────────────
  if (/^url:/i.test(cmd)) {
    const url = cmd.replace(/^url:\s*/i, '').trim();
    return await trainFromUrl(url);
  }

  // ── TRAIN: APPROVE: <id> ─────────────────────────────────────────────────────
  if (/^approve:/i.test(cmd)) {
    const id = cmd.replace(/^approve:\s*/i, '').trim();
    return await approveEntry(id);
  }

  // ── TRAIN: REJECT: <id> ──────────────────────────────────────────────────────
  if (/^reject:/i.test(cmd)) {
    const id = cmd.replace(/^reject:\s*/i, '').trim();
    return await rejectEntry(id);
  }

  // ── TRAIN: CORRECT: <old> | <correct> ────────────────────────────────────────
  if (/^correct:/i.test(cmd)) {
    const body  = cmd.replace(/^correct:\s*/i, '').trim();
    const parts = body.split('|').map(s => s.trim());
    if (parts.length < 2) return `❌ Format: *TRAIN: CORRECT: old answer | correct answer*`;
    return await correctFact(parts[0], parts[1]);
  }

  // ── TRAIN: PENDING ───────────────────────────────────────────────────────────
  if (cmdLower === 'pending') return await listPendingEntries();

  // ── TRAIN: <plain fact> ──────────────────────────────────────────────────────
  if (cmd.length > 5) return await saveFact(cmd);

  return `❓ Unknown training command. Try:\n• *TRAIN: a fact to save*\n• *TRAIN: URL: https://...*\n• *TRAIN: LIST*\n• *TRAIN: STATS*\n• *TRAIN: PENDING*`;
}

// ─── Save a plain fact ────────────────────────────────────────────────────────
async function saveFact(fact) {
  try {
    const db  = await getDb(DB_NAME);
    const doc = {
      content:    fact.trim(),
      title:      fact.trim().slice(0, 80),
      type:       detectFactType(fact),
      source:     'admin_whatsapp',
      verified:   true,
      addedBy:    'admin',
      createdAt:  new Date(),
      updatedAt:  new Date(),
      keywords:   extractKeywords(fact),
    };
    const r = await db.collection('knowledge').insertOne(doc);
    const count = await db.collection('knowledge').countDocuments({ addedBy: 'admin' });
    return (
      `✅ *Learned!* I'll remember:\n_"${fact.trim()}"_\n\n` +
      `📊 You've taught me *${count} facts* total.\n\n` +
      `💡 Type *TRAIN: LIST* to see recent facts\n` +
      `💡 Type *TRAIN: FORGET: <text>* to remove a fact`
    );
  } catch (e) {
    if (e.message.includes('duplicate')) {
      return `ℹ️ I already know this fact! Use *TRAIN: CORRECT: old | new* to update it.`;
    }
    return `❌ Could not save: ${e.message}`;
  }
}

// ─── Forget a fact ────────────────────────────────────────────────────────────
async function forgetFact(text) {
  const db     = await getDb(DB_NAME);
  const regex  = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const result = await db.collection('knowledge').deleteMany({
    $or: [{ content: regex }, { title: regex }],
    addedBy: { $in: ['admin', 'auto', 'system'] }
  });
  if (result.deletedCount === 0) return `⚠️ No facts found matching: _"${text}"_`;
  return `🗑️ Removed *${result.deletedCount}* fact(s) matching: _"${text}"_`;
}

// ─── Correct a fact ────────────────────────────────────────────────────────────
async function correctFact(oldFact, newFact) {
  const db    = await getDb(DB_NAME);
  const regex = new RegExp(oldFact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const r     = await db.collection('knowledge').updateMany(
    { $or: [{ content: regex }, { title: regex }] },
    { $set: { content: newFact.trim(), title: newFact.trim().slice(0, 80), updatedAt: new Date(), verified: true, correctedBy: 'admin' } }
  );
  if (r.matchedCount === 0) {
    // Not found — save as new
    await saveFact(newFact);
    return `✅ Didn't find the old fact, so I saved the new one:\n_"${newFact}"_`;
  }
  return `✅ Corrected *${r.modifiedCount}* entry(ies):\n_Old: "${oldFact}"_\n_New: "${newFact}"_`;
}

// ─── Train from a URL ─────────────────────────────────────────────────────────
async function trainFromUrl(url) {
  if (!url.startsWith('http')) return `❌ URL must start with https:// or http://`;
  try {
    const [topicPart] = url.replace(/https?:\/\//, '').split('/');
    const result = await ingestUrl(url, topicPart);
    return (
      `🌐 *Learned from URL!*\n\n` +
      `• URL: ${url}\n` +
      `• Chunks saved: *${result.saved}* (of ${result.chunks} total)\n\n` +
      `*Content preview:*\n_${result.preview.slice(0, 200)}..._\n\n` +
      `Students can now ask questions about this page! 🧠`
    );
  } catch (e) {
    return `❌ Could not fetch URL: ${e.message}\n\nMake sure the URL is public and accessible.`;
  }
}

// ─── Approve a pending auto-learned entry ─────────────────────────────────────
async function approveEntry(id) {
  try {
    const db = await getDb(DB_NAME);
    const { ObjectId } = require('mongodb');
    await db.collection('knowledge').updateOne(
      { _id: new ObjectId(id) },
      { $set: { verified: true, approvedAt: new Date(), approvedBy: 'admin' } }
    );
    return `✅ Entry *${id}* approved and verified!`;
  } catch (e) {
    return `❌ Could not approve: ${e.message}`;
  }
}

// ─── Reject a pending entry ───────────────────────────────────────────────────
async function rejectEntry(id) {
  try {
    const db = await getDb(DB_NAME);
    const { ObjectId } = require('mongodb');
    await db.collection('knowledge').deleteOne({ _id: new ObjectId(id) });
    return `🗑️ Entry *${id}* rejected and removed.`;
  } catch (e) {
    return `❌ Could not reject: ${e.message}`;
  }
}

// ─── List recent trained facts ─────────────────────────────────────────────────
async function listTrainedFacts() {
  const db = await getDb(DB_NAME);
  const facts = await db.collection('knowledge')
    .find({ addedBy: { $in: ['admin', 'admin_whatsapp'] } })
    .sort({ createdAt: -1 })
    .limit(15)
    .toArray();

  if (!facts.length) return `📋 No facts trained yet. Use *TRAIN: your fact here* to add one!`;

  const list = facts.map((f, i) =>
    `${i + 1}. _${f.title?.slice(0, 70) || f.content?.slice(0, 70)}_\n   📅 ${new Date(f.createdAt).toLocaleDateString('en-UG')} | Type: ${f.type || 'general'}`
  ).join('\n\n');

  return `📋 *Recently Trained Facts (${facts.length}):*\n\n${list}\n\n_Type *TRAIN: FORGET: <text>* to remove any fact_`;
}

// ─── List pending entries awaiting review ─────────────────────────────────────
async function listPendingEntries() {
  const db = await getDb(DB_NAME);
  const pending = await db.collection('knowledge')
    .find({ verified: false })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  if (!pending.length) return `✅ No pending entries — everything is verified!`;

  const list = pending.map((e, i) =>
    `${i + 1}. *${e.title?.slice(0, 60) || '—'}*\n   Source: ${e.source || '?'} | ${e.addedBy || '?'}\n   ID: \`${e._id}\`\n   _TRAIN: APPROVE: ${e._id}_`
  ).join('\n\n');

  return `⏳ *Pending Review (${pending.length}):*\n\n${list}\n\nUse *TRAIN: APPROVE: <id>* or *TRAIN: REJECT: <id>*`;
}

// ─── Training stats ───────────────────────────────────────────────────────────
async function getTrainingStats() {
  const db = await getDb(DB_NAME);
  const [total, verified, pending, adminAdded, autoAdded, ownerLearned] = await Promise.all([
    db.collection('knowledge').countDocuments({}),
    db.collection('knowledge').countDocuments({ verified: true }),
    db.collection('knowledge').countDocuments({ verified: false }),
    db.collection('knowledge').countDocuments({ addedBy: { $in: ['admin', 'admin_whatsapp'] } }),
    db.collection('knowledge').countDocuments({ addedBy: 'auto' }),
    db.collection('knowledge').countDocuments({ source: 'owner_handoff' }),
  ]);
  const lessons = await db.collection('ownerLessons').countDocuments({}).catch(() => 0);

  return (
    `📊 *Zearn Training Stats*\n\n` +
    `🧠 *Total knowledge entries:* ${total}\n` +
    `✅ Verified: ${verified}\n` +
    `⏳ Pending review: ${pending}\n\n` +
    `📝 *Sources:*\n` +
    `• Admin trained (you): ${adminAdded}\n` +
    `• Auto-learned from AI: ${autoAdded}\n` +
    `• Learned from your replies: ${ownerLearned}\n` +
    `• Owner lessons stored: ${lessons}\n\n` +
    `💡 Commands:\n` +
    `• *TRAIN: your fact* — teach me something\n` +
    `• *TRAIN: URL: https://...* — learn from a webpage\n` +
    `• *TRAIN: PENDING* — review auto-learned entries\n` +
    `• *TRAIN: LIST* — see what you've taught me`
  );
}

// ─── Train from a document buffer (called by messageHandler for !learn) ────────
async function trainFromDocument(buffer, mimeType, topic, filename) {
  try {
    const result = await ingestDocument(buffer, mimeType, topic || filename, filename);
    return (
      `📄 *Learned from document!*\n\n` +
      `• File: ${filename}\n` +
      `• Type: ${result.fileType.toUpperCase()}\n` +
      `• Chunks saved: *${result.saved}* (of ${result.chunks} total)\n\n` +
      `*Content preview:*\n_${result.preview.slice(0, 200)}..._\n\n` +
      `Students can now ask questions about this document! 🧠`
    );
  } catch (e) {
    return `❌ Could not read document: ${e.message}`;
  }
}

// ─── Autonomous learning — called after every good AI answer ──────────────────
// This is the "self-training" part — bot learns from its own good answers
let _learnCount = 0;

async function autonomousLearn(question, answer, source = 'ai_answer') {
  try {
    if (!question || question.length < 10) return;
    if (!answer   || answer.length < 80)   return;
    // Don't learn uncertain answers
    if (/i'?m not sure|i don'?t know|please verify|i cannot confirm/i.test(answer)) return;

    // Rate limit — check DB every 100 calls
    _learnCount++;
    if (_learnCount % 100 === 1) {
      const db    = await getDb(DB_NAME);
      const count = await db.collection('knowledge').countDocuments({ verified: false, addedBy: 'auto' });
      if (count >= 300) {
        console.log('[TrainerAgent] Auto-learn queue full (300 pending) — pausing');
        return;
      }
    }

    const type = detectFactType(question + ' ' + answer);
    const db   = await getDb(DB_NAME);
    await db.collection('knowledge').insertOne({
      title:     question.trim().slice(0, 80),
      content:   answer.trim().slice(0, 3000),
      type,
      source,
      verified:  false,
      addedBy:   'auto',
      createdAt: new Date(),
      updatedAt: new Date(),
      keywords:  extractKeywords(question + ' ' + answer),
    });
    console.log(`[TrainerAgent] 🧠 Auto-learned: "${question.slice(0, 50)}"`);
  } catch (e) {
    if (!e.message?.includes('duplicate')) console.log('[TrainerAgent] Auto-learn error:', e.message);
  }
}

// ─── Learn from owner's manual replies ────────────────────────────────────────
async function learnFromOwnerReply(studentJid, studentQuestion, ownerAnswer) {
  if (!ownerAnswer || ownerAnswer.trim().length < 30) return;
  if (/^!/.test(ownerAnswer.trim())) return; // skip commands

  const db  = await getDb(DB_NAME);
  const type = detectFactType(studentQuestion + ' ' + ownerAnswer);

  try {
    // Store in ownerLessons for style reference
    await db.collection('ownerLessons').insertOne({
      studentJid,
      studentQuestion: (studentQuestion || '').slice(0, 500),
      ownerAnswer:     ownerAnswer.trim().slice(0, 2000),
      learnedAt:       new Date(),
    });

    // Also save to knowledge base as verified (owner words = trusted)
    await db.collection('knowledge').insertOne({
      title:     (studentQuestion || ownerAnswer).trim().slice(0, 80),
      content:   ownerAnswer.trim().slice(0, 3000),
      type,
      source:    'owner_handoff',
      verified:  true, // auto-verified — it came from the owner
      addedBy:   'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
      keywords:  extractKeywords((studentQuestion || '') + ' ' + ownerAnswer),
    });
    console.log(`[TrainerAgent] 📖 Learned from owner reply: "${ownerAnswer.slice(0, 50)}"`);
  } catch (e) {
    if (!e.message?.includes('duplicate')) console.log('[TrainerAgent] Owner-learn error:', e.message);
  }
}

// ─── Scheduled weekly learning report ─────────────────────────────────────────
async function getWeeklyLearningReport() {
  const db       = await getDb(DB_NAME);
  const weekAgo  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [newTotal, newAuto, newAdmin, newOwner, totalKB] = await Promise.all([
    db.collection('knowledge').countDocuments({ createdAt: { $gte: weekAgo } }),
    db.collection('knowledge').countDocuments({ createdAt: { $gte: weekAgo }, addedBy: 'auto' }),
    db.collection('knowledge').countDocuments({ createdAt: { $gte: weekAgo }, addedBy: { $in: ['admin', 'admin_whatsapp'] } }),
    db.collection('knowledge').countDocuments({ createdAt: { $gte: weekAgo }, source: 'owner_handoff' }),
    db.collection('knowledge').countDocuments({}),
  ]);

  const topNewEntries = await db.collection('knowledge')
    .find({ createdAt: { $gte: weekAgo } })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  const topList = topNewEntries.map((e, i) =>
    `${i + 1}. _${(e.title || e.content || '').slice(0, 60)}_`
  ).join('\n');

  return (
    `📚 *Zearn Weekly Learning Report*\n\n` +
    `This week I learned *${newTotal} new things!*\n\n` +
    `📊 *Breakdown:*\n` +
    `• Auto-learned from AI answers: ${newAuto}\n` +
    `• You trained me: ${newAdmin}\n` +
    `• Learned from your replies: ${newOwner}\n\n` +
    `*Recent learnings:*\n${topList || '_Nothing yet_'}\n\n` +
    `📦 *Total knowledge base:* ${totalKB} entries\n\n` +
    `Type *TRAIN: PENDING* to review and approve auto-learned entries.`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function detectFactType(text) {
  const t = text.toLowerCase();
  if (/cut.?off|cutoff|points? (?:required|needed|to get)/i.test(t)) return 'cutoff';
  if (/fee|tuition|cost|how much/i.test(t))                          return 'fees';
  if (/scholarship|bursary|fund|grant/i.test(t))                    return 'scholarship';
  if (/jab|government spons/i.test(t))                              return 'jab';
  if (/deadline|intake|close[sd]?|open[sd]?/i.test(t))             return 'deadline';
  if (/abroad|uk|usa|canada|germany|international/i.test(t))        return 'international';
  if (/hec|bridging|result code/i.test(t))                          return 'general';
  return 'general';
}

function extractKeywords(text) {
  const stop = new Set(['the','a','an','and','or','for','to','in','of','is','are','with','has','have','at','by','from','that','this','it','be','as','do','if','on','but']);
  return [...new Set(
    (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w)).slice(0, 20)
  )];
}

module.exports = {
  handle,
  autonomousLearn,
  learnFromOwnerReply,
  trainFromDocument,
  getWeeklyLearningReport,
  getTrainingStats,
};
