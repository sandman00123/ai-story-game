// ----------------------------
// server.js  (Game + Storyboard API)
// ----------------------------
/**
 * Install deps locally (dev):
 *   npm install express cors dotenv node-fetch@2
 *
 * Start locally (Windows CMD):
 *   set OPENAI_API_KEY=sk-...your key...
 *   set PORT=8787
 *   node server.js
 *
 * Deploy on Render:
 *   Build: npm install
 *   Start: node server.js
 *   Env vars (Render → Environment):
 *     OPENAI_API_KEY=sk-...            (required)
 *     PORT=10000                       (Render uses dynamic ports)
 *     SUPABASE_URL=...                 (required for storyboard)
 *     SUPABASE_SERVICE_ROLE=...        (required for storyboard; server-only)
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());
app.get('/api/debug/env', (_req, res) => {
  res.json({
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL || null,
    hasSupabaseRole: !!process.env.SUPABASE_SERVICE_ROLE,
  });
});


// --------- static & root ----------
app.use(express.static(__dirname));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --------- health ----------
app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.OPENAI_API_KEY;
  res.json({ ok: true, hasKey });
});

// ========= GAME: narrator endpoint with mood + dramatic scale =========

function mapDramaToTemp(drama) {
  switch (String(drama)) {
    case "1": return 0.4;
    case "2": return 0.55;
    case "3": return 0.7;
    case "4": return 0.85;
    case "5": return 1.0;
    default: return 0.7;
  }
}

function dramaInstructions(drama) {
  switch (String(drama)) {
    case "1":
      return "Narration style: Write very plain and simple. Short sentences. Minimal detail. Like an amateur storyteller.";
    case "2":
      return "Narration style: Simple narration with some description. A beginner storyteller with a bit of flair.";
    case "3":
      return "Narration style: Balanced detail. Moderate description, engaging but not too theatrical.";
    case "4":
      return "Narration style: Dramatic with vivid imagery and emotional tone. Add suspense and flair.";
    case "5":
      return "Narration style: Extremely dramatic and theatrical. Rich detail, powerful emotions, like a professional novelist.";
    default:
      return "Narration style: Balanced detail, engaging but not too theatrical.";
  }
}
app.post('/api/storyboard/share', async (req, res) => {
  try {
    const { title, mood, drama, content, author } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Missing title or content" });

    const sanitized = {
      title: sanitizeText(title),
      mood: sanitizeText(mood || ''),
      drama: Number(drama) || 3,
      content: sanitizeText(content),
      author: sanitizeText(author || 'Anon')
    };

    const [story] = await sb('/stories', {
      method: 'POST',
      body: JSON.stringify([sanitized])
    });

    res.json({ ok: true, story });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/continue', async (req, res) => {
  try {
    const { history = [], userTurn = '', mood = 'default', drama = 3 } = req.body;

    const baseStyle = `
You are the NARRATOR of a text-adventure game.

STYLE:
- Present tense.
- PG-13; no slurs or explicit sexual content.
- Never mention you are an AI. Never break the fourth wall.
- Always continue directly from the player's last turn.
`.trim();

    const styleMood = (mood && mood !== 'default')
      ? `\n\nMood/Genre: This is a ${mood} story. Match your narration to ${mood} conventions, tone, and atmosphere.`
      : '';

    const styleDrama = `\n\n${dramaInstructions(drama)}`;

    const messages = [
      { role: 'system', content: baseStyle + styleMood + styleDrama },
      ...history,
      { role: 'user', content: userTurn }
    ];

    const payload = {
      model: "gpt-4o-mini",
      input: messages,
      max_output_tokens: 220,
      temperature: mapDramaToTemp(drama)
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ''}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    if (!response.ok) {
      return res.status(500).json({ error: `OpenAI error: ${raw}` });
    }

    let text = '…';
    try {
      const data = JSON.parse(raw);
      if (data.output_text) {
        text = data.output_text;
      } else if (data.output && data.output[0]?.content?.[0]?.text) {
        text = data.output[0].content[0].text;
      }
    } catch {
      // ignore, fallback below
    }

    if (!text || text.trim() === '') {
      text = "The narrator hesitates, then continues cautiously. (Fallback)";
    }

    return res.json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', text: "(Server fallback)" });
  }
});

// ========= STORYBOARD: Supabase wiring =========

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

// Simple PostgREST helper
async function sb(path, init = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE missing).");
  }
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    "apikey": SUPABASE_SERVICE_ROLE,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`[Supabase ${res.status}] ${await res.text()}`);
  return res.json();
}

/**
 * Expected DB schema (run in Supabase SQL editor first):
 *
 * create table if not exists stories (
 *   id uuid primary key default gen_random_uuid(),
 *   title text not null,
 *   mood text,
 *   drama int check (drama between 1 and 5),
 *   content text not null,
 *   likes int not null default 0,
 *   dislikes int not null default 0,
 *   created_at timestamp with time zone default now()
 * );
 *
 * create table if not exists story_comments (
 *   id uuid primary key default gen_random_uuid(),
 *   story_id uuid references stories(id) on delete cascade,
 *   handle text,
 *   body text not null,
 *   created_at timestamp with time zone default now()
 * );
 *
 * create index if not exists idx_stories_created on stories(created_at desc);
 */

// Share a story
app.post('/api/storyboard/share', async (req, res) => {
  try {
    const { title, mood, drama, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Missing title or content" });

    const [story] = await sb('/stories', {
      method: 'POST',
      body: JSON.stringify([{ title, mood, drama: Number(drama) || 3, content }])
    });

    res.json({ ok: true, story });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List recent stories
app.get('/api/storyboard/list', async (_req, res) => {
  try {
    const rows = await sb('/stories?select=*&order=created_at.desc&limit=20');
    res.json({ stories: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Like / Dislike (simple increment — MVP; not race-proof)
app.post('/api/storyboard/react', async (req, res) => {
  try {
    const { story_id, value } = req.body; // value: 1 or -1
    const v = Number(value);
    if (!story_id || ![1, -1].includes(v)) {
      return res.status(400).json({ error: "Invalid reaction" });
    }

    // Read current counts (MVP approach)
    const current = await sb(`/stories?id=eq.${story_id}&select=likes,dislikes`);
    if (!current.length) return res.status(404).json({ error: "Story not found" });
    const { likes, dislikes } = current[0];

    const patch = v === 1 ? { likes: (likes || 0) + 1 } : { dislikes: (dislikes || 0) + 1 };
    const [updated] = await sb('/stories?id=eq.' + story_id, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });

    res.json({ ok: true, story: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Post a comment
app.post('/api/storyboard/comment', async (req, res) => {
  try {
    const { story_id, handle, body } = req.body;
    if (!story_id || !body) return res.status(400).json({ error: "Missing story_id or body" });

    const [row] = await sb('/story_comments', {
      method: 'POST',
      body: JSON.stringify([{ story_id, handle: handle || 'Anon', body }])
    });

    res.json({ ok: true, comment: row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List comments
app.get('/api/storyboard/comments', async (req, res) => {
  try {
    const { story_id } = req.query;
    if (!story_id) return res.status(400).json({ error: "Missing story_id" });

    const rows = await sb(`/story_comments?story_id=eq.${story_id}&select=*&order=created_at.asc`);
    res.json({ comments: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --------- start ----------
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`AI Story server running on http://localhost:${PORT}`);
});

