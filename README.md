# ZEARN BOT — MULTI-AGENT + AUTONOMOUS LEARNING SYSTEM
## Complete Architecture & How Everything Works

---

## THE FULL PICTURE

```
Every WhatsApp message
        │
        ▼
┌───────────────────────────────────────────────┐
│              ORCHESTRATOR                      │
│  Reads message → classifies intent in <1ms    │
│  Routes to the right specialist agent          │
└──────────────────────┬────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │CALCULATOR│  │   HEC    │  │  ADMISSIONS  │
  │  Agent   │  │  Agent   │  │    Agent     │
  │UACE/WASSCE│  │Bridging  │  │Cut-offs,     │
  │PUJAB calc│  │Tracks    │  │courses,unis  │
  └──────────┘  └──────────┘  └──────────────┘
        │              │              │
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │SCHOLARSHIP│  │  NEWS   │  │  RECOMMENDER │
  │  Agent   │  │  Agent  │  │    Agent     │
  │Funding,  │  │Live UNEB │  │Match interests│
  │bursaries │  │JAB dates │  │to courses    │
  └──────────┘  └──────────┘  └──────────────┘
        │              │              │
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │  STUDY   │  │DOCUMENT  │  │   FALLBACK   │
  │  ABROAD  │  │  Agent   │  │    Agent     │
  │UK/USA/DE/│  │Checklists│  │AI Brain for  │
  │China etc │  │Portals   │  │everything else│
  └──────────┘  └──────────┘  └──────────────┘
        │
        ▼
┌───────────────────────────────────────────────┐
│              TRAINER AGENT                    │
│  Admin: TRAIN: fact | URL: ... | STATS        │
│  Auto-learns from every good AI answer        │
│  Learns from owner's manual replies           │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│          AUTONOMOUS LEARNING SCHEDULER         │
│  Every 6h:   Crawl JAB, UNEB, Makerere       │
│  Every 24h:  Crawl Kyambogo, MUBS, MUST       │
│  Every Sunday: Full crawl + weekly report     │
│  Every midnight: Clean stale entries          │
│  Real-time: Learn from every AI answer        │
│  Real-time: Learn from owner's replies        │
└───────────────────────────────────────────────┘
```

---

## HOW THE AGENTS MAKE THE BOT SMARTER

### 1. CALCULATOR AGENT
**Handles:** "Physics A, Chemistry B, Biology C", "calculate pujab for medicine", "A1 B2 C4"
- Parses UACE grades (A=6, B=5... O=1, F=0)
- Parses WASSCE grades (A1=6, B2=5, C4=4...)
- Calculates PUJAB weighted score (Essential×3, Relevant×2, Other×0.5)
- Shows every qualifying course (government + private)
- No API call needed — pure logic, instant response

### 2. HEC AGENT
**Handles:** "what is HEC", "HEC fees", "am I eligible for HEC", "HEC tracks"
- Knows all 5 HEC tracks (HEA, HEB, HEP, HECBS, HEE)
- Knows all institutions offering HEC
- Knows fees, eligibility, how to apply, what happens after
- Answers from knowledge base — no API call needed

### 3. ADMISSIONS AGENT
**Handles:** "Makerere cut-off for medicine", "Kyambogo engineering", "what points for law"
- Searches trained knowledge base first
- Falls back to AI with Uganda-specific system prompt
- Gets more accurate over time as knowledge base grows

### 4. SCHOLARSHIP AGENT
**Handles:** "scholarships for Ugandans", "fully funded", "scholarship for women", "STEM scholarship"
- Local database of 7 major scholarships
- Auto-adds STEM/women-specific scholarships based on query
- Searches trained knowledge for any new scholarships you've added

### 5. NEWS AGENT
**Handles:** "latest UNEB results", "JAB 2026", "when does Makerere intake open"
- Searches trained knowledge base first
- Tries Serper (Google) web search (needs SERPER_API_KEY)
- Falls back to DuckDuckGo (free, no key needed)
- Falls back to static guidance + official URLs

### 6. RECOMMENDER AGENT
**Handles:** "I love biology, what should I study?", "recommend a course for me", "help me choose"
- Maps interests → subject combinations → degrees
- Personalizes based on student profile (grades, target)
- Falls back to AI for nuanced guidance

### 7. STUDY ABROAD AGENT
**Handles:** "study in UK", "Germany scholarship", "how to apply to US university"
- Has built-in guides for UK/USA/Canada/Germany/Australia/China/South Africa/Rwanda
- Searches trained knowledge for any info you've added
- Falls back to AI for complex questions

### 8. DOCUMENT AGENT
**Handles:** "document checklist for Makerere", "personal statement guide", "how to apply to JAB"
- Has step-by-step portal guides for all major Uganda universities
- Personal statement writing guide
- Recommendation letter guide

### 9. TRAINER AGENT (Learning Brain)
**Handles training commands + ALL autonomous learning**

Training via WhatsApp:
```
TRAIN: Makerere 2026 intake opens February 15
TRAIN: URL: https://jab.go.ug
TRAIN: LIST
TRAIN: STATS
TRAIN: PENDING
TRAIN: FORGET: wrong fact here
TRAIN: CORRECT: old answer | correct answer
```

Autonomous learning (no commands):
- Every good AI answer → saved as pending KB entry
- Every time YOU reply to a student → bot learns your exact words (verified instantly)
- Every web crawl → new content saved to KB

### 10. FALLBACK AGENT
**Handles:** everything that doesn't match other agents
- Searches trained knowledge base first
- Routes to AI brain with full student context
- Auto-learns confident answers for next time
- Tracks uncertain answers as knowledge gaps

---

## HOW AUTONOMOUS LEARNING WORKS

### Step 1: A student asks a question
```
Student: "What is the cut-off for Makerere nursing 2026?"
```

### Step 2: Admissions agent handles it
- Searches KB → finds nothing specific for 2026
- Asks AI brain → gets answer: "Makerere Nursing 2026: Govt 15pts, Private 11pts..."

### Step 3: Bot auto-learns the answer
```
autonomousLearn(question, answer) → saves to knowledge.collection (verified: false)
```

### Step 4: Next student asks same question
- KB search finds the saved answer
- Returns instantly (no AI API call needed!)
- Faster + cheaper + consistent

### Step 5: You review pending entries
```
TRAIN: PENDING → shows you 10 pending entries
TRAIN: APPROVE: 65f3a2b1... → marks as verified
```
Or use `/dashboard → Knowledge Base → filter Pending Review`

### Step 6: Owner replies to a student manually
```
Owner types: "The 2026 Makerere medicine intake is now open until March 15"
```
Bot automatically:
- Saves this to `ownerLessons` collection (style reference)
- Saves to `knowledge` collection as **verified** (your words = trusted)
- Next time same question comes up → uses YOUR phrasing

### Step 7: Web crawl (every 6 hours for high-priority sources)
```
Crawls: jab.go.ug, admissions.mak.ac.ug, uneb.ac.ug
Extracts: relevant sections about cut-offs, deadlines, fees
Saves: new chunks to knowledge base (verified: false)
Notifies you if >10 new things learned
```

---

## NEW OWNER COMMANDS

| Command | What it does |
|---------|-------------|
| `!agents` | Show status of all 10 agents |
| `!crawl` | Manual web crawl of high-priority sites now |
| `!crawl jab` | Crawl only JAB website |
| `!crawlstatus` | When each site was last crawled |
| `!gaps` | Questions bot was uncertain about |
| `!learnstats` | Full training statistics |
| `!weeklyreport` | Weekly learning digest |
| `TRAIN: fact` | Teach bot a new fact |
| `TRAIN: URL: https://...` | Learn from a webpage |
| `TRAIN: LIST` | See recent trained facts |
| `TRAIN: STATS` | Training statistics |
| `TRAIN: PENDING` | Review auto-learned entries |
| `TRAIN: APPROVE: <id>` | Approve an entry |
| `TRAIN: REJECT: <id>` | Delete bad entry |
| `TRAIN: FORGET: text` | Remove a wrong fact |
| `TRAIN: CORRECT: old \| new` | Fix a wrong answer |

---

## INSTALLATION ORDER

```bash
# 1. Copy all agent files
cp agents/*.js     your-project/bot/agents/
cp learning/*.js   your-project/bot/learning/

# 2. Apply the 12 integration patches from finalIntegration.js

# 3. Add to package.json dependencies (if not already there):
#    No new npm packages needed! All agents use existing dependencies.

# 4. Set env vars in Render:
TRAIN_PASSWORD=your-secret-password
SERPER_API_KEY=your-key  # optional but recommended for news agent

# 5. Deploy and test:
git add -A
git commit -m "feat: add multi-agent system + autonomous learning"
git push
```

---

## TEST COMMANDS (send these to your bot after deployment)

```
# Calculator agent
"Physics A, Chemistry B, Biology C, GP P"
"I got A1, B2, C4 in WASSCE"
"Calculate my PUJAB weight for Medicine"

# HEC agent
"What is HEC?"
"HEC fees at MUBS"
"Am I eligible for HEC?"
"How do I apply for HEC?"

# News agent  
"Latest UNEB results"
"When does JAB 2026 placement come out?"
"Is Makerere intake open?"

# Scholarship agent
"Scholarships for Ugandan women in STEM"
"Fully funded Masters scholarships"

# Study abroad agent
"How do I study in Germany?"
"CSC scholarship China"
"UK university application process"

# Training commands
"TRAIN: LIST"
"TRAIN: STATS"
"TRAIN: Makerere 2026 intake opens March 1"
"TRAIN: PENDING"

# Admin commands
"!agents"
"!crawlstatus"
"!gaps"
"!learnstats"
```

---

## WHAT THE BOT LEARNS ON ITS OWN (weekly)

Every week Zearn will:
1. Crawl 12 Uganda education websites for updates
2. Save new cut-off points, deadlines, fee changes
3. Learn from all your manual student replies
4. Track which questions it was uncertain about
5. Send you a Monday morning report like:

```
📚 Zearn Weekly Learning Report

This week I learned 47 new things!

Breakdown:
• Auto-learned from AI answers: 31
• You trained me: 8  
• Learned from your replies: 6
• Web crawls: 2

Recent learnings:
1. "Makerere 2026 medicine cut-off is now 19pts..."
2. "JAB placement list released August 12..."
...

Total knowledge base: 312 entries
Type TRAIN: PENDING to review and approve auto-learned entries.
```
