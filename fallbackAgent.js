// bot/agents/fallbackAgent.js
'use strict';
const brain = require('../brain');
const { searchKnowledge } = require('../knowledgeIngestor');
const { autonomousLearn }  = require('./trainerAgent');

async function handle(text, userId, context = [], studentProfile = {}, options = {}) {
  const { mood, convMode } = options;
  if (text.length > 5) {
    const kb = await searchKnowledge(text, 2).catch(() => null);
    if (kb && kb.length > 80) return kb;
  }
  const parts = [];
  if (studentProfile?.name)         parts.push(`Student: ${studentProfile.name}`);
  if (studentProfile?.grades)       parts.push(`Grades: ${studentProfile.grades}`);
  if (studentProfile?.targetCourse) parts.push(`Target: ${studentProfile.targetCourse}`);
  if (studentProfile?.country)      parts.push(`Country: ${studentProfile.country}`);
  const userPrefix = parts.join(' | ');
  let modeInstructions = '';
  if (convMode === 'casual') modeInstructions = 'CASUAL MODE: User is chatting socially. Do NOT bring up university. Just be a warm friendly person.';
  else if (mood === 'distressed') modeInstructions = 'DISTRESSED: Lead with empathy. Do NOT pitch any service. Just listen and support.';
  else if (mood === 'excited')    modeInstructions = 'EXCITED: Match their energy! Celebrate first, then help.';
  else if (mood === 'frustrated') modeInstructions = 'FRUSTRATED: Acknowledge briefly, then give a clearer simpler explanation.';

  const answer = await brain.ask(text, userId, context, userPrefix, modeInstructions);
  if (
    answer && answer.length > 100 &&
    !/i'?m not sure|i don'?t know|please verify|i cannot confirm/i.test(answer) &&
    /university|course|makerere|uace|points?|scholarship|hec|jab|admission/i.test(text)
  ) {
    autonomousLearn(text, answer, 'ai_fallback').catch(() => {});
  }
  return answer;
}
module.exports = { handle };
