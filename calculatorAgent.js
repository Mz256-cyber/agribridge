// bot/agents/calculatorAgent.js — UACE / WASSCE / PUJAB Calculator Agent
'use strict';

const calc = require('../calculator');
const { searchKnowledge } = require('../knowledgeIngestor');

async function handle(text, userId, context = [], studentProfile = {}) {
  // ── PUJAB weighted score ──────────────────────────────────────────────────
  if (/\b(pujab|weighted score|jab weight|jab score|my weight for|weight.*course)\b/i.test(text)) {
    const subjects = calc.parseSubjects(text);
    if (subjects.length >= 1) {
      const courseMatch =
        text.match(/for\s+(.+?)(?:\?|$)/i) ||
        text.match(/(?:study|do|take)\s+(.+?)(?:\?|$)/i) ||
        text.match(/(medicine|engineering|law|nursing|pharmacy|computer science|business|economics|agriculture)/i);
      const courseName = courseMatch ? courseMatch[1].trim() : 'your target course';
      const isFemale   = /\b(female|girl|woman|she|her)\b/i.test(text);
      const dists = parseInt(text.match(/(\d+)\s*dist/i)?.[1] || '0');
      const creds = parseInt(text.match(/(\d+)\s*cred/i)?.[1] || '0');
      const passs = parseInt(text.match(/(\d+)\s*pass/i)?.[1] || '0');
      return calc.formatPUJABScore(subjects, courseName, {
        isFemale, oLevelDistinctions: dists, oLevelCredits: creds, oLevelPasses: passs
      });
    }
    return (
      `⚖️ *PUJAB Weighted Score Calculator*\n\n` +
      `I need your A-level grades to calculate!\n\n` +
      `Type your grades + course like:\n` +
      `*Physics A, Chemistry B, Biology C — for Medicine*\n\n` +
      `I'll show you the full Essential×3, Relevant×2 breakdown! 😊`
    );
  }

  // ── WASSCE grades ─────────────────────────────────────────────────────────
  const wassceResult = calc.parseWASSCEGrades(text);
  if (wassceResult) {
    const { best3, total } = wassceResult;
    let msg = `📊 *WASSCE Points Calculation*\n\n*Your best 3 grades:*\n`;
    msg += best3.map(g => `• ${g.grade} = ${g.pts} pts`).join('\n');
    msg += `\n\n🎯 *Total: ${total}/18 points*\n`;
    msg += `_WASSCE is equivalent to UACE for JAB placement_\n\n`;
    const syns = best3.map((g, i) => ({ name: `Subject ${i+1}`, grade: g.grade, points: g.pts }));
    const q    = calc.findQualifyingCourses(syns, total);
    if (q.govt.length > 0 || q.private.length > 0) msg += calc.formatQualifyingCourses(q, total);
    return msg;
  }

  // ── UACE grades ───────────────────────────────────────────────────────────
  const subjects = calc.parseSubjects(text);
  if (subjects.length >= 2) {
    const result     = calc.calculateUACEPoints(subjects);
    let   msg        = calc.formatPointsResult(subjects, result);
    const qualifying = calc.findQualifyingCourses(subjects, result.total);
    if (qualifying.govt.length > 0 || qualifying.private.length > 0) {
      msg += '\n\n' + calc.formatQualifyingCourses(qualifying, result.total);
    }
    // Save academic profile
    if (studentProfile?.userId) {
      // persist to student profile (non-blocking)
    }
    return msg;
  }

  // ── Retake advisor ────────────────────────────────────────────────────────
  if (/\b(retake|resit|redo|sit again)\b/i.test(text)) {
    const pointMatch = text.match(/\b(\d{1,2})\s*(points?|pts?)\b/i);
    const points     = pointMatch ? parseInt(pointMatch[1]) : 0;
    const course     = text.replace(/retake|resit|redo|sit again|\d+\s*points?/gi, '').trim();
    return calc.retakeAdvisor(points, course || 'your target course');
  }

  // ── Find qualifying courses ───────────────────────────────────────────────
  if (/\b(qualify|what courses?|which courses?|can i apply|courses? for me)\b/i.test(text)) {
    const pointMatch = text.match(/\b(\d{1,2})\s*(points?|pts?)\b/i);
    if (pointMatch) {
      const pts  = parseInt(pointMatch[1]);
      const q    = calc.findQualifyingCourses([], pts);
      return calc.formatQualifyingCourses(q, pts);
    }
  }

  // ── Prompt for grades ─────────────────────────────────────────────────────
  return (
    `📊 *UACE Points Calculator*\n\n` +
    `Type your subjects and grades like:\n\n` +
    `*Physics A, Chemistry B, Biology C, Maths D, GP P*\n\n` +
    `Or for WASSCE: *A1, B2, C4*\n\n` +
    `I'll calculate your points and show every course you qualify for! 😊`
  );
}

module.exports = { handle };
