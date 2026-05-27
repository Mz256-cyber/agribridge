// bot/agents/newsAgent.js — Live Education News Agent
// Fetches current UNEB results, JAB placement, intake dates, and deadlines
'use strict';

const https = require('https');
const { getDb }           = require('../mongoClient');
const { searchKnowledge } = require('../knowledgeIngestor');
const { autonomousLearn } = require('./trainerAgent');

const DB_NAME = process.env.DB_NAME || 'zearnbot';

// ─── Trusted Uganda education news sources ────────────────────────────────────
const NEWS_SOURCES = [
  { name: 'JAB Uganda',          url: 'https://www.jab.go.ug',           keywords: ['cut-off','intake','placement','admission','sponsored'] },
  { name: 'UNEB',                url: 'https://www.uneb.ac.ug',           keywords: ['results','release','grading','examination','2025','2026'] },
  { name: 'Makerere Admissions', url: 'https://admissions.mak.ac.ug',    keywords: ['deadline','intake','application','cut-off','fees'] },
  { name: 'Ministry of Education',url: 'https://www.education.go.ug',    keywords: ['announcement','policy','examination','school','university'] },
];

async function handle(text, userId, context = []) {
  // ── Check trained/cached knowledge first (fastest) ────────────────────────
  const kbAnswer = await searchKnowledge(text, 2).catch(() => null);
  if (kbAnswer && isNewsRelated(kbAnswer)) {
    return formatNewsAnswer(kbAnswer, 'Knowledge Base');
  }

  // ── Try Serper web search ──────────────────────────────────────────────────
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    const webAnswer = await searchSerper(buildQuery(text), serperKey);
    if (webAnswer) {
      // Auto-learn this answer for next time
      autonomousLearn(text, webAnswer, 'news_search').catch(() => {});
      return webAnswer;
    }
  }

  // ── Try DuckDuckGo (free, no key) ─────────────────────────────────────────
  const ddgAnswer = await searchDDG(buildQuery(text));
  if (ddgAnswer) {
    autonomousLearn(text, ddgAnswer, 'news_ddg').catch(() => {});
    return ddgAnswer;
  }

  // ── Fallback: general knowledge answer ────────────────────────────────────
  return getStaticNewsInfo(text);
}

function buildQuery(text) {
  const year = new Date().getFullYear();
  const t    = text.toLowerCase();
  if (/uneb|results?|grade/i.test(t))    return `UNEB Uganda results ${year}`;
  if (/jab|placement|sponsorship/i.test(t)) return `JAB Uganda placement cut-off ${year}`;
  if (/makerere.*intake|mak.*intake/i.test(t)) return `Makerere University intake ${year}`;
  if (/intake|application.*open/i.test(t)) return `Uganda university intake application ${year}`;
  if (/deadline/i.test(t))               return `Uganda university application deadline ${year}`;
  return `Uganda university education news ${year}`;
}

async function searchSerper(query, key) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ q: query, num: 4, gl: 'ug', hl: 'en' });
    const buf  = Buffer.from(body);
    const req  = https.request(
      { hostname: 'google.serper.dev', path: '/search', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length, 'X-API-KEY': key } },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (!data.organic?.length) { resolve(null); return; }
            const results = data.organic.slice(0, 3).map(r =>
              `• *${r.title}*\n  ${r.snippet}${r.link ? '\n  🔗 ' + r.link : ''}`
            ).join('\n\n');
            const answer =
              `📰 *Latest Uganda Education News*\n` +
              `_(${new Date().toLocaleDateString('en-UG')})_\n\n${results}\n\n` +
              `_Always verify important dates at the official university or UNEB website._`;
            resolve(answer);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.write(buf); req.end();
  });
}

async function searchDDG(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const req = https.get(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
      { timeout: 6000 },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            let result = '';
            if (data.AbstractText?.length > 50) result += data.AbstractText + '\n\n';
            (data.RelatedTopics || []).slice(0, 3).forEach(t => {
              if (t.Text?.length > 30) result += `• ${t.Text}\n`;
            });
            if (result.trim().length > 60) {
              resolve(
                `📰 *Uganda Education Update*\n\n${result.trim()}\n\n` +
                `_Source: DuckDuckGo — verify at official sources_`
              );
            } else { resolve(null); }
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function getStaticNewsInfo(text) {
  const t = text.toLowerCase();
  const yr = new Date().getFullYear();

  if (/uneb|result/i.test(t)) {
    return (
      `📰 *UNEB Results Information*\n\n` +
      `• UACE (A-level) results: usually released November–December\n` +
      `• UCE (O-level) results: usually released January–February\n` +
      `• Check results at: *uneb.ac.ug*\n` +
      `• SMS service: text your index number to UNEB short code\n\n` +
      `⚠️ _I don't have real-time access to today's announcements._\n` +
      `_For the latest: visit uneb.ac.ug or call 0414-285-500_`
    );
  }
  if (/jab|placement|government.*spons/i.test(t)) {
    return (
      `📰 *JAB Placement Information*\n\n` +
      `• JAB results usually released: July–August each year\n` +
      `• Check placement at: *jab.go.ug*\n` +
      `• Confirmation of placement: usually August–September\n` +
      `• Government-sponsored places are free (no tuition)\n\n` +
      `⚠️ _For ${yr} specific dates, check jab.go.ug directly._`
    );
  }
  if (/intake|application/i.test(t)) {
    return (
      `📰 *University Intake Information*\n\n` +
      `*Typical Uganda university intake schedule:*\n` +
      `• Applications open: February–June\n` +
      `• Government (JAB) intake: August–September\n` +
      `• Private intake: rolling (some universities accept year-round)\n\n` +
      `*Check official portals:*\n` +
      `• Makerere: admissions.mak.ac.ug\n` +
      `• Kyambogo: apply.kyu.ac.ug\n` +
      `• JAB: jab.go.ug\n\n` +
      `⚠️ _Dates change yearly — always confirm on the official site._`
    );
  }
  return (
    `📰 *Uganda Education News*\n\n` +
    `I can search for the latest updates on:\n` +
    `• UNEB results releases\n` +
    `• JAB placement lists\n` +
    `• University intake dates\n` +
    `• Application deadlines\n\n` +
    `*Official sources to check:*\n` +
    `• uneb.ac.ug — UNEB results\n` +
    `• jab.go.ug — JAB placement\n` +
    `• admissions.mak.ac.ug — Makerere\n` +
    `• education.go.ug — Ministry of Education\n\n` +
    `What specific update are you looking for? 😊`
  );
}

function isNewsRelated(text) {
  return /date|deadline|intake|open|close|result|placement|announce|${new Date().getFullYear()}/i.test(text);
}

function formatNewsAnswer(text, source) {
  return `📰 *Latest Update*\n_(from ${source})_\n\n${text}`;
}

module.exports = { handle };
