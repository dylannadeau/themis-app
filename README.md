# Themis — Litigation Case Intelligence

A personalized litigation case discovery platform for FTI Consulting professionals. Built with Next.js, Supabase, and Google Gemini.

## Features

- **AI-Powered Search**: RAG-based semantic search across case summaries using vector embeddings
- **Personalized Ranking**: Like/dislike cases to build a preference profile; results rerank over time
- **BYOK (Bring Your Own Key)**: Users provide their own Google Gemini API key — zero LLM cost to operator
- **Consultant Matching**: Pre-computed consultant rankings with scores and explanations
- **Filtering**: Filter by viability, score, nature of suit, source, date range

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS |
| Backend | Vercel Serverless Functions |
| Database | Supabase (PostgreSQL + pgvector) |
| Auth | Supabase Auth (email/password) |
| LLM | Google Gemini (user-provided API key) |
| Embeddings | BAAI/bge-large-en-v1.5 via HuggingFace Inference API |
| Hosting | Vercel (free tier) |

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/themis-app.git
cd themis-app
npm install
```

### 2. Create Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In the SQL Editor, run the migration file: `supabase/migrations/001_initial_schema.sql`
3. In Project Settings > API, copy your **URL** and **anon public** key

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon key
- `API_KEY_ENCRYPTION_SECRET` — generate with `openssl rand -hex 32`
- `HUGGINGFACE_API_TOKEN` — free token from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Deploy to Vercel

1. Push to GitHub
2. Import repo in [vercel.com](https://vercel.com)
3. Add all env vars from `.env.local` to Vercel's Environment Variables
4. Deploy

## Project Structure

```
src/
├── app/
│   ├── auth/page.tsx          # Sign in / sign up
│   ├── dashboard/page.tsx     # Personalized case feed + filters
│   ├── search/page.tsx        # RAG search with Gemini synthesis
│   ├── cases/[id]/page.tsx    # Case detail with consultant rankings
│   ├── settings/page.tsx      # BYOK API key + model preference
│   ├── api/
│   │   ├── search/route.ts    # Vector search + Gemini synthesis
│   │   ├── react/route.ts     # Like/dislike + preference updates
│   │   └── settings/route.ts  # API key encryption + validation
│   ├── layout.tsx
│   ├── page.tsx               # Root redirect
│   └── globals.css
├── components/
│   ├── AppShell.tsx           # Navigation shell
│   ├── CaseCard.tsx           # Case preview card with reactions
│   └── FilterPanel.tsx        # Sidebar filters
├── lib/
│   ├── supabase-browser.ts    # Client-side Supabase client
│   ├── supabase-server.ts     # Server-side Supabase client
│   ├── encryption.ts          # AES-256-GCM encrypt/decrypt
│   ├── personalization.ts     # Preference scoring & reranking
│   └── types.ts               # TypeScript types
└── middleware.ts              # Auth redirect middleware
```

## Data Pipeline

Data is populated via the offline Jupyter notebook (`Themis.ipynb`):

1. Bloomberg Law API → `docket_db.csv`
2. Complaint extraction + Gemini summarization → `cases.csv`
3. Consultant matching + LLM ranking → `results.csv`
4. Supabase sync (upsert cases, chunks, consultant_results)

The web application never calls Bloomberg Law directly.

## Cost

**$0/month** on free tiers. Users pay their own Gemini API costs (~$0.01-0.10 per search depending on model).
