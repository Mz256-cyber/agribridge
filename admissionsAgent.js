// bot/agents/admissionsAgent.js
'use strict';
const calc = require('../calculator');
const { searchKnowledge } = require('../knowledgeIngestor');
const brain = require('../brain');

async function handle(text, userId, context = [], studentProfile = {}) {
  const kb = await searchKnowledge(text, 3).catch(() => null);
  if (kb && kb.length > 100) return kb;

  const intent = calc.detectIntent(text);
  if (intent === 'weighted_score') {
    const subjects = calc.parseSubjects(text);
    const cMatch = text.match(/for\s+(.+?)(?:\?|$)/i) || text.match(/(medicine|engineering|law|nursing|pharmacy|computer|business|economics)/i);
    const course = cMatch ? cMatch[1].trim() : null;
    if (subjects.length >= 2 && course) {
      const r = calc.calculateWeightedScore(subjects, course);
      if (r) return calc.formatWeightedScore(r);
    }
  }
  if (intent === 'find_courses') {
    const pm = text.match(/\b(\d{1,2})\s*(points?|pts?)\b/i);
    if (pm) return calc.formatQualifyingCourses(calc.findQualifyingCourses([], parseInt(pm[1])), parseInt(pm[1]));
  }

  const parts = [];
  if (studentProfile?.name)         parts.push(`Student: ${studentProfile.name}`);
  if (studentProfile?.grades)       parts.push(`Grades: ${studentProfile.grades}`);
  if (studentProfile?.targetCourse) parts.push(`Wants: ${studentProfile.targetCourse}`);
  const userPrefix = parts.join(' | ');

  const sys = `You are Zearn, Uganda admissions expert. Answer accurately.
Universities: Makerere, Kyambogo, MUBS, MUST, Gulu, Busitema, Lira, Kabale, Soroti, Muni, MMU, UCU, KIU, IUIU.
UACE max=20 pts. PUJAB: Essential×3, Relevant×2, Other×0.5.
Keep reply under 250 words. WhatsApp formatting.`;
  return await brain.ask(text, userId, context, userPrefix, sys);
}
module.exports = { handle };
