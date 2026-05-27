// bot/agents/studyAbroadAgent.js
'use strict';
const brain = require('../brain');
const { searchKnowledge } = require('../knowledgeIngestor');

const COUNTRY_GUIDES = {
  uk:        `🇬🇧 *UK:* UCAS (ucas.com) | Deadline Jan 15 | UACE accepted | IELTS 6.0–7.0 | £15k–35k/yr\n*Scholarships:* Chevening (full) chevening.org | Commonwealth cscuk.fcdo.gov.uk`,
  usa:       `🇺🇸 *USA:* Common App (commonapp.org) | SAT/ACT needed | TOEFL 80+/IELTS 6.5+ | $20k–75k/yr\n*Scholarships:* Fulbright (apply US Embassy Kampala) | MasterCard Foundation`,
  canada:    `🇨🇦 *Canada:* Apply direct to each university | IELTS 6.5+ | CAD $15k–35k/yr | Post-study work permit 1–3yrs`,
  germany:   `🇩🇪 *Germany:* FREE tuition at public universities! Only €150–350/semester admin fee | English Masters available | Apply: uni-assist.de\n*Scholarship:* DAAD (full) daad.de — apply Oct–Dec`,
  australia: `🇦🇺 *Australia:* Apply direct or via IDP Education | IELTS 6.0–6.5+ | AUD $20k–45k/yr | Work rights during study\n*Scholarship:* Australia Awards (full) dfat.gov.au/australiaawards`,
  china:     `🇨🇳 *China:* Affordable: $2k–6k/yr | English programmes available\n*CSC Scholarship (FULLY FUNDED):* tuition + accommodation + monthly stipend | Apply Feb–April at campuschina.org or Chinese Embassy Kampala`,
  south_africa: `🇿🇦 *South Africa:* UCT, Wits, Stellenbosch — Africa's top unis | ZAR 40k–80k/yr (~UGX 8–16M) | UACE accepted directly`,
  rwanda:    `🇷🇼 *Rwanda:* University of Rwanda, Carnegie Mellon Africa (tech focus) | Very affordable for East Africans | Close to Uganda`,
};

const ALIASES = {
  uk: ['uk','united kingdom','england','britain','ucas','london','oxford','cambridge'],
  usa: ['usa','america','united states','us university','harvard','mit','stanford','yale','ivy'],
  canada: ['canada','toronto','ubc','mcgill','waterloo','ottawa'],
  germany: ['germany','german','daad','deutsch','berlin','munich','heidelberg'],
  australia: ['australia','melbourne','sydney','anu','monash','brisbane'],
  china: ['china','beijing','chinese','csc scholarship','tsinghua','peking','fudan','wuhan'],
  south_africa: ['south africa','cape town','uct','wits','stellenbosch'],
  rwanda: ['rwanda','kigali','carnegie mellon africa'],
};

async function handle(text, userId, context = [], studentProfile = {}) {
  const t = text.toLowerCase();
  for (const [country, guide] of Object.entries(COUNTRY_GUIDES)) {
    const keys = ALIASES[country] || [country];
    if (keys.some(k => t.includes(k))) {
      const sp = studentProfile?.name ? `Hi *${studentProfile.name}*! ` : '';
      return sp + guide + `\n\n_Need help with your application? Type *apply* — our team handles it for UGX 15,000!_ 😊`;
    }
  }
  const kb = await searchKnowledge('study abroad Uganda ' + text, 2).catch(() => null);
  if (kb && kb.length > 100) return kb;
  if (/study abroad|international|overseas|foreign university/i.test(t)) {
    return (
      `🌍 *Studying Abroad — Overview for Ugandans*\n\n` +
      `*Top destinations:*\n` +
      `🇩🇪 Germany — FREE tuition, DAAD scholarship\n` +
      `🇨🇳 China — CSC scholarship (full), very popular\n` +
      `🇬🇧 UK — UCAS, Chevening scholarship\n` +
      `🇺🇸 USA — Fulbright scholarship\n` +
      `🇦🇺 Australia — Australia Awards (full)\n` +
      `🇨🇦 Canada — Good work rights post-study\n\n` +
      `*Which country interests you?* Name it and I'll give you the full guide! 😊\n\n` +
      `_Type *apply* — our team handles international applications for UGX 15,000!_`
    );
  }
  const sys = `You are Zearn, Uganda's international education advisor. Help this Ugandan student with study abroad info. Be specific: entry requirements, IELTS scores, scholarships, fees, visa. Mention Uganda-specific advantages. Keep under 250 words.`;
  return await brain.ask(text, userId, context, '', sys);
}
module.exports = { handle };
