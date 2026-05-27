// ═══════════════════════════════════════════════════════════════════════
// ZEARN BOT — FINAL INTEGRATION PATCH
// Exact code to copy-paste into messageHandler.js and index.js
// ═══════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════
// PART A: messageHandler.js changes
// ════════════════════════════════════════════

// ── 1. ADD at the very top of messageHandler.js (after existing requires) ────
/*
const { orchestrate, classifyIntent } = require('./agents/orchestrator');
const trainerAgent   = require('./agents/trainerAgent');
const { startScheduler, saveKnowledgeGap } = require('../learning/learningScheduler');
*/

// ── 2. REPLACE learnFromOwner() with this ────────────────────────────────────
async function learnFromOwner(studentJid, ownerReply) {
  if (!ownerReply || ownerReply.trim().length < 10) return;
  if (/^!/.test(ownerReply.trim())) return;
  try {
    let studentQuestion = '';
    try {
      const ctx = await memory.getRecentContext(studentJid, 1);
      if (ctx?.length > 0) {
        const last = ctx[ctx.length - 1];
        studentQuestion = last?.content || last?.text || '';
      }
    } catch (e) {}
    await trainerAgent.learnFromOwnerReply(studentJid, studentQuestion, ownerReply.trim());
  } catch (e) {
    console.log('[learnFromOwner] Error:', e.message);
  }
}

// ── 3. REPLACE autoLearn() with this ─────────────────────────────────────────
async function autoLearn(question, answer) {
  await trainerAgent.autonomousLearn(question, answer, 'ai_answer');
}

// ── 4. FIND the handleOwnerCommand function, ADD these new cases ─────────────
// Add BEFORE the return false; at the end of handleOwnerCommand():

async function newOwnerCommands(sock, jid, cmd, text, parts) {

  // !agents — show status of all agents
  if (cmd === '!agents') {
    const { getAgentStatus } = require('./agents/orchestrator');
    const status = await getAgentStatus();
    const lines  = Object.entries(status)
      .map(([name, s]) => `• *${name}:* ${s}`)
      .join('\n');
    await sock.sendMessage(jid, {
      text: `🤖 *Agent Status:*\n\n${lines}\n\n_10 specialist agents running — each handles specific question types for faster, more accurate answers._`
    });
    return true;
  }

  // !crawl [filter] — manual web crawl
  if (cmd === '!crawl') {
    const { runManualCrawl } = require('../learning/learningScheduler');
    const filter = parts[1] || null;
    await sock.sendMessage(jid, { text: `🌐 Starting crawl${filter ? ' for "' + filter + '"' : ' of high-priority sources'}... ☕` });
    const result = await runManualCrawl(filter);
    await sock.sendMessage(jid, { text: result });
    return true;
  }

  // !crawlstatus — show when each source was last crawled
  if (cmd === '!crawlstatus') {
    const { getSchedulerStatus } = require('../learning/learningScheduler');
    const status = await getSchedulerStatus();
    await sock.sendMessage(jid, { text: status });
    return true;
  }

  // !gaps — show questions bot was uncertain about
  if (cmd === '!gaps') {
    const { analyzeKnowledgeGaps } = require('../learning/learningScheduler');
    const gaps = await analyzeKnowledgeGaps();
    if (!gaps) {
      await sock.sendMessage(jid, { text: `✅ No knowledge gaps recorded yet — bot has answered everything confidently!` });
    } else {
      await sock.sendMessage(jid, { text: gaps });
    }
    return true;
  }

  // !learnstats — full learning statistics
  if (cmd === '!learnstats') {
    const stats = await trainerAgent.getTrainingStats();
    await sock.sendMessage(jid, { text: stats });
    return true;
  }

  // !weeklyreport — manual trigger for weekly learning digest
  if (cmd === '!weeklyreport') {
    const report = await trainerAgent.getWeeklyLearningReport();
    await sock.sendMessage(jid, { text: report });
    return true;
  }

  return false;
}

// ── 5. ADD TRAIN: command detection early in handleMessage() ─────────────────
// Add this IMMEDIATELY after the owner command check block:
/*
  // TRAIN: command — admin training (owner or anyone with password)
  if (/^train:/i.test(text)) {
    const response = await trainerAgent.handle(text, senderId, { isOwner });
    await sendWithTyping(sock, jid, response);
    return;
  }
*/

// ── 6. REPLACE the main AI answering block ───────────────────────────────────
// FIND this block (around line 600-700 in your messageHandler.js):
//
//   const shouldSearchKb = (!isSmallTalk(text) && convMode !== 'casual' && isEducationQuery(text)...);
//   const kbAnswer = shouldSearchKb ? await kb.query(text)... : null;
//   if (kbAnswer && ...) { ... return; }
//   const ingestedAnswer = await ingestor.searchKnowledge(text)...
//   if (ingestedAnswer && ...) { ... return; }
//   const liveAnswer = await updater.liveSearch(text)...
//   if (liveAnswer) { ... return; }
//   await antiBan.simulateReading(text);
//   let answer = await brain.ask(text, senderId, context, userPrefix, modeInstructions);
//   ... selfCorrect ... consumeFreeQuestion ...
//
// REPLACE THE ENTIRE BLOCK WITH:

async function handleMessageWithAgents(sock, jid, senderId, text, context, studentProfile, mood, convMode, isOwner, isSmallTalk_result) {

  // Small talk always goes direct to AI (no agents needed)
  if (isSmallTalk_result) {
    const answer = await brain.ask(text, senderId, context, '', getModeInstructions(convMode, mood));
    await sendLongMessageWithTyping(sock, jid, cleanForWhatsApp(answer));
    return;
  }

  // Route through multi-agent system
  const agentResult = await orchestrate(text, senderId, context, studentProfile, {
    mood, convMode, isOwner
  });

  let finalAnswer = cleanForWhatsApp(agentResult);

  // Self-correct factual answers
  if (!isSmallTalk_result) {
    try { finalAnswer = await selfCorrect(text, finalAnswer); } catch (e) {}
  }

  // Prepend mood opener if needed
  const moodOpener = getMoodOpener(mood, studentProfile?.nickname || studentProfile?.name);
  if (moodOpener) finalAnswer = `${moodOpener}\n\n${finalAnswer}`;

  // Strip pitch if distressed
  if (shouldSuppressPitch(mood)) {
    finalAnswer = finalAnswer.replace(/\n*[💡🌟✨].*?apply.*?UGX.*?\n?/gi, '').trim();
  }

  await sendLongMessageWithTyping(sock, jid, finalAnswer);

  // Save to context
  try { await memory.addToContext(senderId, text, cleanForWhatsApp(finalAnswer)); } catch (e) {}

  // Track knowledge gaps when bot was uncertain
  if (/i'?m not sure|i don'?t know|please verify|i cannot confirm/i.test(finalAnswer)) {
    saveKnowledgeGap(text, senderId).catch(() => {});
  }

  // Consume free question for real questions
  if (!isSmallTalk(text)) {
    await consumeFreeQuestion(senderId).catch(() => {});
    // Warn when running low
    const updatedAccess = await checkAccess(senderId).catch(() => ({ type: 'free', remaining: 99 }));
    if (updatedAccess.type === 'free' && updatedAccess.remaining <= 3 && updatedAccess.remaining > 0) {
      await antiBan.sleep(500);
      await sock.sendMessage(jid, {
        text: `💡 *Heads up!* You have *${updatedAccess.remaining} free question${updatedAccess.remaining === 1 ? '' : 's'}* left today.\n\n🌅 Resets at midnight — or unlock unlimited for *UGX 2,000 / 6 hours*. 😊`
      });
    }
  }
}

// ── 7. Also handle !learn for document ingestion via trainerAgent ─────────────
// FIND in handleOwnerCommand:
//   if (cmd === '!learn') { ... ingestUrl / ingestText ... }
// REPLACE with:

async function handleLearnCommand(sock, jid, text, msg, isDocument, docCaption) {
  const rest = text.replace(/^!learn\s*/i, '').trim();

  // Document ingestion
  if (isDocument) {
    const topicLabel = docCaption?.replace(/^!learn\s*/i, '').trim() || null;
    const mimeType   = msg?.message?.documentMessage?.mimetype || 'application/octet-stream';
    const fileName   = msg?.message?.documentMessage?.fileName || 'document';
    await sock.sendMessage(jid, { text: `📄 Reading *${fileName}*... give me a moment!` });
    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const result = await trainerAgent.trainFromDocument(buffer, mimeType, topicLabel, fileName);
      await sock.sendMessage(jid, { text: result });
    } catch (e) {
      await sock.sendMessage(jid, { text: `❌ Could not read: ${e.message}` });
    }
    return true;
  }

  // URL ingestion
  if (/^https?:\/\//i.test(rest)) {
    const [url, topicLabel] = rest.split('|').map(s => s.trim());
    const trainText = `TRAIN: URL: ${url}`;
    const response  = await trainerAgent.handle(trainText, null, { isOwner: true });
    await sock.sendMessage(jid, { text: response });
    return true;
  }

  // Text ingestion
  if (rest.length > 10) {
    const [content, topic] = rest.split('|').map(s => s.trim());
    const response = await trainerAgent.handle(`TRAIN: ${content}`, null, { isOwner: true });
    await sock.sendMessage(jid, { text: response });
    return true;
  }

  await sock.sendMessage(jid, {
    text:
      `📚 *!learn — Teach Zearn new knowledge*\n\n` +
      `*From URL:*\n!learn https://jab.go.ug | JAB Admissions\n\n` +
      `*From text:*\n!learn The 2026 JAB deadline is March 31 | JAB Deadlines\n\n` +
      `*From document:*\nSend PDF/DOCX with caption: !learn Topic Name\n\n` +
      `_Or use: TRAIN: your fact here (works from any WhatsApp number with the password)_`
  });
  return true;
}

// ════════════════════════════════════════════
// PART B: index.js changes
// ════════════════════════════════════════════

// ── 8. ADD requires at top of index.js ───────────────────────────────────────
/*
const {
  startScheduler,
  stopScheduler,
  restoreCrawlState,
  getSchedulerStatus,
  runManualCrawl,
  analyzeKnowledgeGaps,
} = require('./bot/learning/learningScheduler');
const trainerAgent = require('./bot/agents/trainerAgent');
*/

// ── 9. ADD to connection.update handler when connection === 'open' ────────────
// FIND: console.log(`[Bot:${cfg.id}] ✅ Connected to WhatsApp!`);
// ADD AFTER (only for main bot):
/*
  if (cfg.isMain) {
    // Restore crawl timestamps from MongoDB
    await restoreCrawlState().catch(e => console.log('[Scheduler] Restore error:', e.message));
    // Start autonomous learning scheduler
    startScheduler(sock, ownerJid());
    console.log('[Zearn] 🧠 Autonomous learning scheduler started');
  }
*/

// ── 10. ADD to connection.update handler when connection === 'close' ──────────
// FIND: try { await coordinator.markOffline(cfg.id); } catch (e) {}
// ADD AFTER (only for main bot):
/*
  if (cfg.isMain) {
    stopScheduler();
  }
*/

// ── 11. ADD weekly learning report to scheduled jobs ─────────────────────────
// FIND the setInterval that checks for 7am Uganda time (!summary):
/*
  // 7:05 AM — Weekly learning report (Mondays only)
  if (h === 7 && m === 5 && now.getUTCDay() === 1) {
    const report = await trainerAgent.getWeeklyLearningReport().catch(e => `Report error: ${e.message}`);
    if (sock) sock.sendMessage(ownerJid(), { text: report }).catch(() => {});
  }
*/

// ── 12. ADD to !help owner command ───────────────────────────────────────────
// Add to the !help text output:
/*
  `*🤖 Agents & Learning*\n` +
  `!agents — show all agent statuses\n` +
  `!crawl [filter] — manual web crawl now\n` +
  `!crawlstatus — when each source was last crawled\n` +
  `!gaps — knowledge gaps (what bot is unsure about)\n` +
  `!learnstats — full training statistics\n` +
  `!weeklyreport — weekly learning digest\n\n` +
  `TRAIN: fact — teach bot via WhatsApp\n` +
  `TRAIN: URL: https://... — learn from webpage\n` +
  `TRAIN: LIST — see trained facts\n` +
  `TRAIN: STATS — training stats\n` +
  `TRAIN: PENDING — review auto-learned entries\n`
*/

module.exports = {
  learnFromOwner,
  autoLearn,
  newOwnerCommands,
  handleMessageWithAgents,
  handleLearnCommand,
};
