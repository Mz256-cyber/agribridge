// bot/agentIntegration.js
// ═══════════════════════════════════════════════════════════════════════
// HOW TO INTEGRATE THE MULTI-AGENT SYSTEM INTO YOUR EXISTING ZEARN BOT
// ═══════════════════════════════════════════════════════════════════════
// This file shows exactly WHERE and WHAT to add to your existing files.
// Follow the numbered steps in order.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

// ════════════════════════════════════════════════════════════════════════
// STEP 1 — Add new files to your project
// ════════════════════════════════════════════════════════════════════════
//
// Copy these files into your bot/ folder:
//
//   bot/agents/orchestrator.js       ← main router
//   bot/agents/trainerAgent.js       ← learning + training commands
//   bot/agents/calculatorAgent.js    ← UACE/WASSCE/PUJAB
//   bot/agents/newsAgent.js          ← live news
//   bot/agents/allAgents.js          ← admissions/scholarship/hec/etc
//   bot/learning/learningScheduler.js ← autonomous crawling
//
// Also split allAgents.js into individual files:
//   bot/agents/admissionsAgent.js
//   bot/agents/scholarshipAgent.js
//   bot/agents/recommenderAgent.js
//   bot/agents/hecAgent.js
//   bot/agents/studyAbroadAgent.js
//   bot/agents/documentAgent.js
//   bot/agents/fallbackAgent.js
//
// (Or keep them in allAgents.js and require from there — both work)

// ════════════════════════════════════════════════════════════════════════
// STEP 2 — Modify messageHandler.js
// ════════════════════════════════════════════════════════════════════════

// ADD these requires at the TOP of messageHandler.js:
/*
const { orchestrate }          = require('./agents/orchestrator');
const { autonomousLearn,
        learnFromOwnerReply,
        trainFromDocument }    = require('./agents/trainerAgent');
const { saveKnowledgeGap }     = require('../learning/learningScheduler');
*/

// ── A) Replace the learnFromOwner function ─────────────────────────────
// FIND:   async function learnFromOwner(studentJid, ownerReply) {
// REPLACE with:
async function learnFromOwner_NEW(studentJid, ownerReply) {
  if (!ownerReply || ownerReply.trim().length < 10) return;
  if (/^!/.test(ownerReply.trim())) return;

  // FIX: use agents/trainerAgent instead of direct DB calls
  let studentQuestion = '';
  try {
    const ctx = await memory.getRecentContext(studentJid, 1);
    if (ctx?.length > 0) {
      const last = ctx[ctx.length - 1];
      studentQuestion = last?.content || last?.text || '';
    }
  } catch (e) {}

  // trainerAgent handles both ownerLessons + knowledge base
  await learnFromOwnerReply(studentJid, studentQuestion, ownerReply.trim());
}

// ── B) Replace the autoLearn function ─────────────────────────────────
// FIND:   async function autoLearn(question, answer) {
// REPLACE with:
async function autoLearn_NEW(question, answer) {
  // Delegate to trainerAgent — it handles the counter/queue correctly
  await autonomousLearn(question, answer, 'ai_answer');
}

// ── C) Replace the TRAIN command handling ─────────────────────────────
// FIND in handleOwnerCommand():
//   if (cmd === '!learn') { ... }
// REPLACE with:
async function handleTrainCommand(sock, jid, text, isOwner) {
  // Now handled by trainerAgent
  const { handle: trainerHandle } = require('./agents/trainerAgent');
  const response = await trainerHandle(text, null, { isOwner: true });
  await sock.sendMessage(jid, { text: response });
}
// Then add to handleOwnerCommand():
//   if (text.toLowerCase().startsWith('train:')) {
//     return handleTrainCommand(sock, jid, text, true);
//   }

// ── D) Replace !learn owner command ──────────────────────────────────
// FIND in handleOwnerCommand():
//   if (cmd === '!learn') { ... }
// REPLACE with:
async function handleLearnCommand_NEW(sock, jid, text, msg, isDocument, docCaption) {
  // For document ingestion
  if (isDocument) {
    const topicLabel = (docCaption || '').replace(/^!learn\s*/i, '').trim() || null;
    const mimeType   = msg?.message?.documentMessage?.mimetype || 'application/octet-stream';
    const fileName   = msg?.message?.documentMessage?.fileName || 'document';
    await sock.sendMessage(jid, { text: `📄 Reading *${fileName}*... give me a moment!` });
    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const result = await trainFromDocument(buffer, mimeType, topicLabel, fileName);
      await sock.sendMessage(jid, { text: result });
    } catch (e) {
      await sock.sendMessage(jid, { text: `❌ Could not read document: ${e.message}` });
    }
    return true;
  }
  // For URL/text — delegate to trainerAgent
  const trainText = text.replace(/^!learn\s*/i, 'TRAIN: URL: ').trim();
  return handleTrainCommand(sock, jid, trainText, true);
}

// ── E) Wire orchestrator into the main message flow ───────────────────
// FIND this section in handleMessage() — the KB + AI waterfall:
//
//   const kbAnswer = shouldSearchKb ? await kb.query(text)... : null;
//   if (kbAnswer && ...) { ... return; }
//   const ingestedAnswer = await ingestor.searchKnowledge(text)...
//   ...
//   const answer = await brain.ask(text, ...);
//
// REPLACE the ENTIRE section (from KB query to brain.ask) with:

async function routeToAgents(text, userId, context, studentProfile, mood, convMode) {
  const result = await orchestrate(text, userId, context, studentProfile, {
    mood, convMode,
    isOwner: false,
  });

  // Track knowledge gaps
  if (result.agent === 'fallback' && /i'?m not sure|i don'?t know|please verify/i.test(result.text)) {
    saveKnowledgeGap(text, userId).catch(() => {});
  }

  return result.text;
}

// ── F) Add TRAIN: command detection EARLY in handleMessage ────────────
// ADD this right after the owner command check:
/*
  // TRAIN: commands — open to owner or anyone with the password
  if (/^train:/i.test(text)) {
    const { handle: trainerHandle } = require('./agents/trainerAgent');
    const response = await trainerHandle(text, senderId, { isOwner });
    await sock.sendMessage(jid, { text: response });
    return;
  }
*/

// ── G) Track AI answer quality for auto-learning ─────────────────────
// FIND after the brain.ask() call:
//   await memory.addToContext(senderId, text, cleanForWhatsApp(answer));
// ADD AFTER:
/*
  // Auto-learn confident education answers
  if (
    !isSmallTalk(text) &&
    isEducationQuery(text) &&
    answer?.length > 100 &&
    !/i'?m not sure|i don'?t know|please verify/i.test(answer)
  ) {
    autonomousLearn(text, cleanForWhatsApp(answer)).catch(() => {});
  }
  // Track uncertainty as knowledge gap
  if (/i'?m not sure|i don'?t know|please verify/i.test(answer)) {
    saveKnowledgeGap(text, senderId).catch(() => {});
  }
*/

// ════════════════════════════════════════════════════════════════════════
// STEP 3 — Modify index.js (main bot entry point)
// ════════════════════════════════════════════════════════════════════════

// ADD these requires at top of index.js:
/*
const { startScheduler, restoreCrawlState, getSchedulerStatus, runManualCrawl } 
  = require('./bot/learning/learningScheduler');
*/

// ADD inside the 'connection.update' handler, when connection === 'open':
/*
  if (connection === 'open' && cfg.isMain) {
    // Restore crawl state and start autonomous learning
    await restoreCrawlState();
    startScheduler(sock, ownerJid());
    console.log('[Zearn] 🧠 Autonomous learning scheduler started');
  }
*/

// ADD to owner commands (handleOwnerCommand):
/*
  if (cmd === '!crawl') {
    const filter = parts[1] || null;
    const result = await runManualCrawl(filter);
    await sock.sendMessage(jid, { text: result });
    return true;
  }
  if (cmd === '!crawlstatus') {
    const status = await getSchedulerStatus();
    await sock.sendMessage(jid, { text: status });
    return true;
  }
  if (cmd === '!agents') {
    const { getAgentStatus } = require('./bot/agents/orchestrator');
    const status = await getAgentStatus();
    const lines  = Object.entries(status).map(([name, s]) => `• ${name}: ${s}`).join('\n');
    await sock.sendMessage(jid, { text: `🤖 *Agent Status:*\n\n${lines}` });
    return true;
  }
*/

// ════════════════════════════════════════════════════════════════════════
// STEP 4 — Add new owner commands summary
// ════════════════════════════════════════════════════════════════════════
//
// After integration, these new commands work:
//
//   TRAIN: your fact here            → save a fact
//   TRAIN: URL: https://...          → learn from a website
//   TRAIN: LIST                      → see trained facts
//   TRAIN: STATS                     → training statistics
//   TRAIN: PENDING                   → review auto-learned entries
//   TRAIN: APPROVE: <id>             → approve an entry
//   TRAIN: REJECT: <id>              → reject an entry
//   TRAIN: FORGET: text to remove    → delete a fact
//   TRAIN: CORRECT: old | new        → correct a wrong fact
//   (send PDF/DOCX with "TRAIN: Topic" caption) → learn from document
//
//   !crawl                           → manual web crawl now
//   !crawl jab                       → crawl JAB only
//   !crawlstatus                     → see when each site was last crawled
//   !agents                          → check all agent statuses
//   !gaps                            → see knowledge gaps (what bot is unsure about)
//
// ════════════════════════════════════════════════════════════════════════
// STEP 5 — How students can train the bot (WhatsApp)
// ════════════════════════════════════════════════════════════════════════
//
// Anyone (with password) can train via WhatsApp:
//
//   TRAIN: yourpassword: Makerere 2026 intake opens Feb 15
//   TRAIN: yourpassword: URL: https://jab.go.ug/results
//   TRAIN: yourpassword: LIST
//
// Set password in .env: TRAIN_PASSWORD=yourpassword
//
// ════════════════════════════════════════════════════════════════════════
// STEP 6 — What happens automatically (no commands needed)
// ════════════════════════════════════════════════════════════════════════
//
// ✅ Every 6 hours:   Bot crawls JAB, UNEB, Makerere admissions for updates
// ✅ Every 24 hours:  Bot crawls Kyambogo, MUBS, MUST, Ministry of Education
// ✅ Every Sunday:    Full crawl of all sources + weekly learning report sent to you
// ✅ Every midnight:  Old low-quality auto-learned entries cleaned up
// ✅ Real-time:       Every good AI answer is saved as pending KB entry
// ✅ Real-time:       Every time YOU manually reply to a student, bot learns your words
// ✅ Real-time:       Knowledge gaps tracked (questions bot was uncertain about)
//
// You review and approve auto-learned entries at:
//   /dashboard → Knowledge Base → filter "Pending Review"
//   or via WhatsApp: TRAIN: PENDING
//
// ════════════════════════════════════════════════════════════════════════

module.exports = {
  learnFromOwner_NEW,
  autoLearn_NEW,
  handleTrainCommand,
  handleLearnCommand_NEW,
  routeToAgents,
};
