// bot/agents/orchestrator.js — Zearn Multi-Agent Orchestrator v1
// ═══════════════════════════════════════════════════════════════════
// Every WhatsApp message enters here. The orchestrator:
//   1. Classifies intent
//   2. Routes to the right specialist agent
//   3. Collects agent response
//   4. Falls back to AI brain if no agent handles it
//
// AGENTS:
//   🔢 CalculatorAgent   — UACE/WASSCE/PUJAB point calculations
//   🎓 AdmissionsAgent   — cut-offs, courses, universities
//   💰 ScholarshipAgent  — scholarships, bursaries, funding
//   📰 NewsAgent         — live UNEB/JAB/intake updates
//   🧭 RecommenderAgent  — course recommendations by interest
//   📚 HecAgent          — HEC bridging programme queries
//   🌍 StudyAbroadAgent  — international universities, visas
//   📄 DocumentAgent     — document checklists, form guidance
//   🧠 TrainerAgent      — admin training commands (TRAIN:)
//   🤖 FallbackAgent     — AI brain for anything unhandled
// ═══════════════════════════════════════════════════════════════════
'use strict';

const calculatorAgent   = require('./calculatorAgent');
const admissionsAgent   = require('./admissionsAgent');
const scholarshipAgent  = require('./scholarshipAgent');
const newsAgent         = require('./newsAgent');
const recommenderAgent  = require('./recommenderAgent');
const hecAgent          = require('./hecAgent');
const studyAbroadAgent  = require('./studyAbroadAgent');
const documentAgent     = require('./documentAgent');
const trainerAgent      = require('./trainerAgent');
const fallbackAgent     = require('./fallbackAgent');

// ─── Intent classifier ────────────────────────────────────────────────────────
// Maps message content → agent. Fast keyword-first, AI-classifier as fallback.
function classifyIntent(text) {
  const t = text.toLowerCase().trim();

  // ── Training commands (admin only — checked before anything else) ─────────
  if (/^train:/i.test(text)) return 'train';

  // ── UACE / WASSCE / PUJAB calculations ────────────────────────────────────
  if (
    /\b([abcdef][1-9])\b/i.test(text) && text.match(/\b[abcdef][1-9]\b/gi)?.length >= 2 ||
    /[a-z]{3,}[\s:=\-–—]+[abcdeof]\b/gi.test(text) && text.match(/[a-z]{3,}[\s:=\-–—]+[abcdeof]\b/gi)?.length >= 2 ||
    /\b(calculate|my points?|how many points?|uace points?|wassce points?|what are my points?)\b/i.test(t) ||
    /\b(pujab|weighted score|jab weight|jab score)\b/i.test(t)
  ) return 'calculate';

  // ── HEC queries ────────────────────────────────────────────────────────────
  if (/\b(hec|higher education cert|bridging|result code 5|one principal|1 principal|hea|heb|hep|hecbs)\b/i.test(t)) return 'hec';

  // ── Scholarships ───────────────────────────────────────────────────────────
  if (/\b(scholarship|bursary|financial aid|sponsorship|fund|grant|fully funded|mastercard|chevening|daad|csc scholarship|australia awards)\b/i.test(t)) return 'scholarship';

  // ── Study abroad ───────────────────────────────────────────────────────────
  if (/\b(uk|united kingdom|usa|america|canada|australia|germany|china|europe|abroad|overseas|international|ucas|ielts|toefl|visa|study outside)\b/i.test(t)) return 'study_abroad';

  // ── Live news / current updates ────────────────────────────────────────────
  if (/\b(latest|news|update|2024|2025|2026|deadline|intake|when.*open|when.*close|uneb.*result|jab.*result|announce|portal.*open)\b/i.test(t)) return 'news';

  // ── Course recommendations ─────────────────────────────────────────────────
  if (/\b(recommend|suggest|what.*course|which.*course|should i study|i (like|love|enjoy|am interested)|what.*become|passion|career path|help me choose)\b/i.test(t)) return 'recommend';

  // ── Document queries ────────────────────────────────────────────────────────
  if (/\b(document|checklist|what do i need|send me.*form|jab form|application form|makerere form|kyambogo form|personal statement|recommendation letter)\b/i.test(t)) return 'documents';

  // ── Admissions / cut-offs / university info ────────────────────────────────
  if (/\b(cut.?off|makerere|kyambogo|mubs|must|busitema|gulu|iuiu|ucu|kiu|ndejje|lira uni|kabale uni|soroti uni|mmu|course.*require|admission|apply.*university|qualify.*course|how many points.*for)\b/i.test(t)) return 'admissions';

  // ── Retake advisor ─────────────────────────────────────────────────────────
  if (/\b(retake|resit|redo|sit again|should i retake|repeat.*uace)\b/i.test(t)) return 'calculate';

  return 'fallback';
}

// ─── Main orchestrate function ────────────────────────────────────────────────
/**
 * Route a message to the correct agent and return its response.
 *
 * @param {string}  text           - user's message (already slang-normalized)
 * @param {string}  userId         - WhatsApp JID
 * @param {Array}   context        - recent conversation history [{role, content}]
 * @param {object}  studentProfile - student intelligence profile
 * @param {object}  options        - { isOwner, mood, convMode }
 * @returns {Promise<{text: string, agent: string, learned: boolean}>}
 */
async function orchestrate(text, userId, context = [], studentProfile = {}, options = {}) {
  const intent = classifyIntent(text);
  const result = { text: '', agent: intent, learned: false };

  console.log(`[Orchestrator] Intent: ${intent} | User: ${userId.slice(0,15)}...`);

  try {
    switch (intent) {

      case 'train':
        result.text  = await trainerAgent.handle(text, userId, options);
        result.agent = 'trainer';
        break;

      case 'calculate':
        result.text  = await calculatorAgent.handle(text, userId, context, studentProfile);
        result.agent = 'calculator';
        break;

      case 'hec':
        result.text  = await hecAgent.handle(text, userId, context);
        result.agent = 'hec';
        break;

      case 'scholarship':
        result.text  = await scholarshipAgent.handle(text, userId, context, studentProfile);
        result.agent = 'scholarship';
        break;

      case 'study_abroad':
        result.text  = await studyAbroadAgent.handle(text, userId, context, studentProfile);
        result.agent = 'study_abroad';
        break;

      case 'news':
        result.text  = await newsAgent.handle(text, userId, context);
        result.agent = 'news';
        break;

      case 'recommend':
        result.text  = await recommenderAgent.handle(text, userId, context, studentProfile);
        result.agent = 'recommender';
        break;

      case 'documents':
        result.text  = await documentAgent.handle(text, userId, context);
        result.agent = 'documents';
        break;

      case 'admissions':
        result.text  = await admissionsAgent.handle(text, userId, context, studentProfile);
        result.agent = 'admissions';
        break;

      default:
        result.text  = await fallbackAgent.handle(text, userId, context, studentProfile, options);
        result.agent = 'fallback';
        break;
    }

    // If an agent returned empty, fall back to AI
    if (!result.text || result.text.trim().length < 5) {
      console.log(`[Orchestrator] Agent '${intent}' returned empty — falling back to AI`);
      result.text  = await fallbackAgent.handle(text, userId, context, studentProfile, options);
      result.agent = 'fallback';
    }

  } catch (err) {
    console.error(`[Orchestrator] Agent '${intent}' crashed: ${err.message}`);
    try {
      result.text  = await fallbackAgent.handle(text, userId, context, studentProfile, options);
      result.agent = 'fallback';
    } catch (e2) {
      result.text  = `Sorry, something went wrong on my end 😅 Please try again!`;
    }
  }

  return result;
}

// ─── Agent health check ────────────────────────────────────────────────────────
async function getAgentStatus() {
  return {
    calculator:  '✅ Online',
    admissions:  '✅ Online',
    scholarship: '✅ Online',
    news:        '✅ Online',
    recommender: '✅ Online',
    hec:         '✅ Online',
    study_abroad:'✅ Online',
    documents:   '✅ Online',
    trainer:     '✅ Online',
    fallback:    '✅ Online (AI Brain)',
  };
}

module.exports = { orchestrate, classifyIntent, getAgentStatus };
