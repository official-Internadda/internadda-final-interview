# InternAdda — AI-Powered Mock Interview Platform

Full-stack AI-powered mock interview platform white-labeled for **upforge.org** ("Powered by InternAdda for Upforge.org"). Features a **Super Premium Silver/White Executive Theme**, a **Perplexity-Style Voice Mode UI**, and automated proctoring.

---

## 🚨 URGENT — Rotate Your Groq API Key

A previous commit (`Create .env.local`) accidentally committed a **real, live Groq API key** to this **public** repository. That key must be treated as compromised:

1. Go to [console.groq.com/keys](https://console.groq.com/keys), delete the old key, and generate a new one.
2. Never commit `.env.local` again — this update adds a `.gitignore` that excludes it, plus a safe `.env.example` template.
3. To scrub the secret from git history (recommended since the repo is public), from the repo root:
   ```bash
   # Since the leak is in the very first/only commit, the simplest fix is
   # to squash history so the key never appears in any commit users can see:
   git checkout --orphan clean-main
   git add -A
   git commit -m "Clean history: remove secrets, upgrade voice interview"
   git branch -D main
   git branch -m main
   git push -f origin main
   ```
   Then re-add all your env vars in the Vercel dashboard (Settings → Environment Variables) using the **new**, rotated key.

---

## 🔐 Default Admin Credentials

- **Admin Login Page**: `/admin/login`
- **Username**: `upforge`
- **Password**: `Upforge@24/7`

---

## 🔑 Where to Add API Keys (To Make it Fully Live & Working)

The AI layer now tries providers in order — **Groq → Gemini → OpenRouter → static fallback** — so if one is briefly rate-limited or down, the interview keeps going instead of freezing. Only Groq is required; the other two are free and strongly recommended for reliability.

### Step 1: Get Your Free API Keys (none require a credit card)

1. **Groq (primary)** — [console.groq.com/keys](https://console.groq.com/keys) — free key, starts with `gsk_...`.
2. **Google Gemini (fallback #1)** — [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) — free tier, no card needed.
3. **OpenRouter (fallback #2)** — [openrouter.ai/keys](https://openrouter.ai/keys) — create a key, then pick any model tagged **`:free`** from [openrouter.ai/models](https://openrouter.ai/models) (e.g. `meta-llama/llama-3.3-70b-instruct:free`).
4. **Supabase Postgres (free tier)** — [supabase.com](https://supabase.com) → new project → **Project Settings → API** for your `Project URL` and `anon public key` → **SQL Editor** to run `schema.sql`.

---

### Step 2: Configure Environment Variables

#### For Local Development:
Copy `.env.example` to `.env.local` (this file is git-ignored and will never be committed):

```bash
cp .env.example .env.local
```

Then fill in your real keys inside `.env.local`:

```env
GROQ_API_KEY=gsk_your_groq_key_here
GEMINI_API_KEY=your_gemini_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

ADMIN_JWT_SECRET=change-this-to-a-long-random-string
```

#### For Live Production on Vercel:
1. Go to your project on **[Vercel Dashboard](https://vercel.com)**.
2. Navigate to **Settings** → **Environment Variables**.
3. Add `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_JWT_SECRET`.
4. Redeploy the project.

---

## 🌟 Key Features

1. **Super Premium Silver/White Executive UI**: Sleek silver glassmorphism, glowing accents, clean typography, and a **Light/Dark Theme Switcher**.
2. **Semi-Automatic Voice Interview Mode** (rebuilt for reliability — see below):
   - **Glowing Interactive Audio Orb**: Pulsing orb visualizer showing when the AI is speaking or listening.
   - **Text-to-Speech (TTS)**: The AI greets the candidate and asks questions aloud automatically.
   - **Candidate-Controlled Mic**: A push-to-talk style **Start Mic / Stop Mic** button — the candidate decides exactly when they're speaking, instead of a fragile always-on listener.
   - **Editable Answer Box**: Every spoken answer is transcribed live into an editable text box, so candidates can correct misheard words or simply type instead — always a working fallback.
   - **Optional Auto-Listen / Auto-Submit toggles**: for candidates who prefer the old fully-hands-free flow, both can be switched back on from the top control bar.
   - **Browser-support detection**: if a browser doesn't support voice recognition (e.g. Firefox), the UI automatically switches to a clear "type your answer" mode instead of silently failing.
3. **Multi-Provider AI Fallback**: Groq → Gemini → OpenRouter → static fallback, so a single provider outage doesn't stall the interview.
4. **Automated Proctoring**: Client-side face detection + tab switch monitoring with instant disqualification on integrity violations.
5. **22 Corporate Categories & Difficulty Tiers**: Tailored evaluation rubrics for AI/ML, Finance, Sales, Product, Legal, HR, etc.
6. **Printable Candidate Reports**: Executive PDF print export with score breakdowns and strengths analysis.

---

## 🎙️ Voice Mode: What Changed & How It Works Now

The old build used a fully-automatic "always listening, auto-submit on silence" flow. In practice that's the most common source of "voice doesn't work" reports, because:

- Chrome/Edge is the only browser family with solid `SpeechRecognition` support — Firefox has none, and Safari is inconsistent. The old code just failed silently on those browsers.
- The recognizer would sometimes restart itself in a loop, or stay "stuck" if a `start()`/`stop()` call raced with the AI's TTS playback.
- Auto-submitting on 2 seconds of silence sometimes cut candidates off mid-thought, with no way to fix a misheard word before it was sent.

This version makes the flow **semi-automatic** instead:

| Step | Behavior |
|---|---|
| Greeting & questions | Spoken automatically by the AI (TTS), same as before |
| Mic | Candidate taps **Start Mic** / **Stop Mic** — no more relying on silence detection to know when you're "done" |
| Transcript | Shown live in an **editable textbox** — fix a misheard word, or just type the whole answer instead |
| Submit | Explicit **Submit Answer** button — always enabled once there's text, never auto-fires unless you turn "Auto-submit" on |
| Auto-listen / Auto-submit | Optional toggles in the top bar, for teams that want the fully hands-free feel back |
| Unsupported browser | Automatically shows a "type your answer" banner instead of a dead mic button |

If you still see issues in production, open the interview, press **Ctrl+Shift+D** (or the bug icon) to open the dev telemetry panel — it shows which AI provider answered the last turn and the exact error message if all three failed.

---

## 🚀 Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- **Admin Login**: [http://localhost:3000/admin/login](http://localhost:3000/admin/login) (`upforge` / `Upforge@24/7`)
- **Demo Voice Interview**: [http://localhost:3000/interview/demo-interview-1](http://localhost:3000/interview/demo-interview-1)
