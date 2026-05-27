// bot/agents/hecAgent.js
'use strict';
const calc = require('../calculator');
const { searchKnowledge } = require('../knowledgeIngestor');

async function handle(text, userId, context = []) {
  const kb = await searchKnowledge('HEC Higher Education Certificate Uganda ' + text, 2).catch(() => null);
  if (kb && kb.length > 80) return kb;
  return calc.getHecInfo(text);
}
module.exports = { handle };
