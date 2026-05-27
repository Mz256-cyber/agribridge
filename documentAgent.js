// bot/agents/documentAgent.js
'use strict';
const calc = require('../calculator');

const PORTAL_GUIDES = {
  makerere: { url: 'admissions.mak.ac.ug', fee: 'UGX 50,000', steps: ['Visit admissions.mak.ac.ug','Register with email','Enter UACE & UCE results','Choose preferred courses (ranked)','Upload certified documents','Pay fee','Submit & await admission list'] },
  kyambogo: { url: 'apply.kyu.ac.ug',       fee: 'UGX 55,000', steps: ['Visit apply.kyu.ac.ug','Create account','Fill in academic details','Upload documents','Pay UGX 55,000','Submit'] },
  mubs:     { url: 'mubs.ac.ug/admissions', fee: 'UGX 40,000', steps: ['Visit mubs.ac.ug/admissions','Register online','Complete application form','Submit certified results','Pay fee'] },
  jab:      { url: 'jab.go.ug',             fee: 'FREE',        steps: ['Wait for UACE results','Visit jab.go.ug','Enter your index number','Submit course choices (up to 6)','Check placement list in August','Confirm your place & report to university'] },
  uneb:     { url: 'uneb.ac.ug',            fee: 'UGX 25,000', steps: ['Visit uneb.ac.ug','Go to Verification Services','Enter index number & year','Pay online','Receive verified certificate'] },
  must:     { url: 'must.ac.ug/admissions', fee: 'UGX 30,000', steps: ['Visit must.ac.ug/admissions','Download or fill online form','Attach certified certificates','Pay at Centenary Bank','Submit'] },
};

async function handle(text, userId, context = []) {
  const t = text.toLowerCase();
  if (/personal statement|motivation letter|why i want/i.test(t)) {
    return (
      `📝 *Personal Statement Guide*\n\n` +
      `A great personal statement has 5 parts:\n\n` +
      `1️⃣ *Opening hook* — Start with a real story or experience (2–3 lines)\n` +
      `2️⃣ *Why this course?* — Specific reasons, not generic (3–4 lines)\n` +
      `3️⃣ *Your background* — Relevant subjects, achievements (3–4 lines)\n` +
      `4️⃣ *Activities/experience* — Work, volunteering, leadership (2–3 lines)\n` +
      `5️⃣ *Future goals* — What you'll do with the degree in Uganda (2–3 lines)\n\n` +
      `*Length:* 500–600 words (Uganda) | 650 words (UCAS UK)\n\n` +
      `💡 *Tip:* Never start with "I have always wanted to be a doctor." Start with a real experience!\n\n` +
      `_Need help writing yours? Type *apply* — we write personal statements for UGX 15,000!_ 😊`
    );
  }
  if (/recommendation|reference letter|referee/i.test(t)) {
    return (
      `📝 *Recommendation Letter Guide*\n\n` +
      `A strong recommendation letter should:\n\n` +
      `✅ Come from a teacher, headteacher, or employer who knows you well\n` +
      `✅ Be on official letterhead with a signature and stamp\n` +
      `✅ Mention specific achievements and qualities\n` +
      `✅ Explain why you're ready for university\n` +
      `✅ Include the writer's contact details\n\n` +
      `*For Uganda universities:* 1–2 letters needed\n` +
      `*For UK/USA/international:* 2–3 letters needed\n\n` +
      `💡 *Tip:* Give your referee at least 2 weeks notice and provide your CV and course details so they can write specifically for you.\n\n` +
      `_Need help? Type *apply* and our team guides you through the whole process!_ 😊`
    );
  }
  for (const [uni, info] of Object.entries(PORTAL_GUIDES)) {
    if (t.includes(uni) || (uni === 'jab' && /jab|government spons/i.test(t))) {
      const steps = info.steps.map((s, i) => `${i+1}️⃣ ${s}`).join('\n');
      return (
        `📋 *How to Apply — ${uni.charAt(0).toUpperCase() + uni.slice(1)}*\n\n` +
        `🌐 *Portal:* ${info.url}\n` +
        `💰 *Fee:* ${info.fee}\n\n` +
        `*Steps:*\n${steps}\n\n` +
        `_Need help navigating the portal? Type *apply* — our team handles it for UGX 15,000!_ 😊`
      );
    }
  }
  const uni = text.replace(/document|checklist|what do i need|requirements? for applying|to apply/gi, '').trim();
  return calc.getDocumentChecklist(uni || 'university');
}
module.exports = { handle };
