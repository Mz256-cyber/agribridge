// bot/agents/recommenderAgent.js
'use strict';
const calc  = require('../calculator');
const brain = require('../brain');

async function handle(text, userId, context = [], studentProfile = {}) {
  const career = text.replace(/recommend|suggest|what.*course|should i study|i (?:like|love|enjoy|am interested in)|help me choose/gi, '').trim();
  const combos = career.length > 3 ? calc.getSubjectComboAdvice(career) : [];
  if (combos.length > 0) {
    let msg = calc.formatSubjectComboAdvice(career, combos);
    if (studentProfile?.grades) msg += `\n\n💡 _Based on your grades (${studentProfile.grades}), you may already qualify for some of these!_`;
    return msg;
  }
  const sp  = studentProfile?.name ? `Student: ${studentProfile.name}` : '';
  const sys = `You are Zearn, Uganda education counsellor. Help student choose a university course.
If unclear, ask ONE question about their interests. Otherwise recommend 3-5 courses with:
- Course + best Uganda university for it
- UACE cut-off points (mention max=20)
- Career paths in Uganda/East Africa
Keep warm, under 200 words. End with a follow-up question.`;
  return await brain.ask(text, userId, context, sp, sys);
}
module.exports = { handle };
