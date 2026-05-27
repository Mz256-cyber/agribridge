// bot/agents/scholarshipAgent.js
'use strict';
const calc = require('../calculator');
const brain = require('../brain');
const { searchKnowledge } = require('../knowledgeIngestor');

async function handle(text, userId, context = [], studentProfile = {}) {
  const kb = await searchKnowledge('scholarship Uganda ' + text, 3).catch(() => null);
  if (kb && kb.length > 100) return kb;
  const pm  = text.match(/\b(\d{1,2})\s*(points?|pts?)\b/i);
  const pts = pm ? parseInt(pm[1]) : 0;
  const t   = text.toLowerCase();
  let msg   = calc.checkScholarships(pts, true);
  if (/tech|it|computer|engineering|stem/i.test(t)) {
    msg += `\n\n💻 *Extra STEM Scholarships:*\n• Google Africa Scholarships\n• Huawei Seeds for the Future\n• MTN Scholarship (ICT Uganda)\n• DIKU (Denmark) — CS postgrad`;
  }
  if (/female|girl|woman|ladies/i.test(t)) {
    msg += `\n\n👩 *Scholarships for Women:*\n• Uganda Women's Scholarship (FAWE) — fawe.org/uganda\n• AAUW International Fellowships\n• L'Oréal-UNESCO For Women in Science`;
  }
  if (/postgrad|masters?|mba|phd/i.test(t)) {
    msg += `\n\n🎓 *Postgrad Scholarships:*\n• Chevening (UK) — chevening.org\n• DAAD Germany — daad.de\n• Commonwealth Scholarship — cscuk.fcdo.gov.uk\n• Aga Khan Foundation — akdn.org/scholarship`;
  }
  return msg;
}
module.exports = { handle };
