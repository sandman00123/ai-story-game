// ----------------------------
// server.js  (with drama style mapping)
// ----------------------------
/**
 * Requirements (in project folder):
 *   npm install express cors dotenv node-fetch@2
 *
 * Start in Windows CMD:
 *   cd "C:\Users\USER\OneDrive\Desktop\fast games\ai-text-game"
 *   set OPENAI_API_KEY=sk-...your key...
 *   set PORT=8787
 *   node server.js
 *
 * Then open: http://localhost:8787/index.html
 */
 const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

async function sb(path, init = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    "apikey": SUPABASE_SERVICE_ROLE,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers||{}) } });
  if (!res.ok) throw new Error(`[Supabase ${res.status}] ${await res.text()}`);
  return res.json();
}

 const express = require('express');
 const cors = require('cors');
 const fetch = require('node-fetch');
 const path = require('path');
 require('dotenv').config({ path: path.join(__dirname, '.env') });
 
 const app = express();
 app.use(cors());
 app.use(express.json());
 
 // ---------- Request logger ----------
 app.use((req, res, next) => {
   console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
   next();
 });
 
 // ---------- Serve static files ----------
 app.use(express.static(__dirname));
 
 // ---------- Health endpoint ----------
 app.get('/api/health', (req, res) => {
   const hasKey = !!process.env.OPENAI_API_KEY;
   res.json({ ok: true, hasKey });
 });
 
 // ---------- Dramatic scale mapping ----------
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
 
 // ---------- Story continuation endpoint ----------
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
 
     console.log('Calling OpenAI with drama:', drama, 'temp:', payload.temperature);
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
     } catch (e) {
       console.error('JSON parse failed:', e);
     }
 
     if (!text || text.trim() === '') {
       text = "The narrator hesitates, then continues cautiously. (Fallback)";
     }
 
     return res.json({ text });
   } catch (err) {
     console.error('Server exception:', err);
     return res.status(500).json({ error: 'Server error', text: "(Server fallback)" });
   }
 });
 
 // ---------- Start server ----------
 const PORT = process.env.PORT || 8787;
 app.listen(PORT, () => {
   console.log(`AI Story server running on http://localhost:${PORT}`);
 });

 
