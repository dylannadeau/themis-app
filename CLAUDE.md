# CLAUDE.md — Themis App

Comprehensive guide for AI assistants working on this codebase.

## Project Overview

**Themis** is a personalized litigation case discovery platform built for legal professionals. It uses vector embeddings + RAG to surface relevant cases, then reranks results based on a per-user preference profile built from explicit feedback (likes/dislikes, narrative comments). Users bring their own Google Gemini API key (BYOK model), so zero LLM cost is passed to the operator.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| UI | React 18, Tailwind CSS 3.4, Lucide React |
| Language | TypeScript 5.5 (strict mode) |
| Database | Supabase (PostgreSQL + pgvector) |
| Auth | Supabase Auth (email/password, SSR cookies) |
| LLM | Google Gemini (user-provided key, BYOK) |
| Embeddings | BAAI/bge-large-en-v1.5 via HuggingFace Inference API |
| Hosting | Vercel (serverless functions) |
| Doc parsing | Mammoth (`.docx` bio upload) |

## Repository Structure

```
src/
├── app/
│   ├── api/
│   │   ├── search/route.ts       # POST: vector search → rerank → Gemini synthesis
│   │   ├── react/route.ts        # POST: like/dislike tracking + preference weight update
│   │   ├── settings/route.ts     # GET/PUT: API key (encrypted), model, bio
│   │   └── narrative/route.ts    # GET/POST: narrative save + Gemini signal extraction
│   ├── auth/page.tsx             # Sign in / sign up page
│   ├── dashboard/page.tsx        # Personalized case feed with filters
│   ├── search/page.tsx           # RAG search interface
│   ├── settings/page.tsx         # BYOK key, model selection, bio upload
│   ├── cases/[id]/page.tsx       # Case detail, consultant rankings, reactions
│   ├── layout.tsx                # Root layout (fonts, globals)
│   ├── page.tsx                  # Root → redirects to /dashboard
│   ├── globals.css               # Tailwind base + custom CSS
│   └── middleware.ts             # IMPORTANT: this is unused (see src/middleware.ts)
├── components/
│   ├── AppShell.tsx              # Sticky nav, mobile menu, sign-out
│   ├── CaseCard.tsx              # Case preview: reactions, favorites, narrative toggle
│   ├── FilterPanel.tsx           # Collapsible sidebar: NOS, date, source, favorites
│   ├── NarrativeFeedback.tsx     # Textarea for feedback with signal extraction UI
│   └── ExplainabilityTags.tsx    # Badges showing which preferences boosted ranking
├── lib/
│   ├── types.ts                  # All TypeScript interfaces + GEMINI_MODELS constant
│   ├── encryption.ts             # AES-256-GCM encrypt/decrypt for API keys
│   ├── personalization.ts        # Core reranking logic (see Personalization section)
│   ├── supabase-browser.ts       # Client-side Supabase (singleton)
│   └── supabase-server.ts        # Server-side Supabase with SSR cookie handling
└── middleware.ts                 # Route protection + auth redirect (THIS is the active one)
```

> **Note**: There is a `src/app/middleware.ts` that appears to be a leftover — the active middleware is `src/middleware.ts` at the project root of `src/`.

## Environment Variables

```bash
# Public (exposed to browser)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Private (server-only)
API_KEY_ENCRYPTION_SECRET=   # 32-byte hex string; generate: openssl rand -hex 32
HUGGINGFACE_API_TOKEN=       # Free token from huggingface.co/settings/tokens
```

**Encryption fallback**: If `API_KEY_ENCRYPTION_SECRET` is missing, encryption falls back to SHA-256 of the Supabase anon key. Always set the secret explicitly in production.

## Development Commands

```bash
npm run dev      # Start dev server on http://localhost:3000
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint via next lint
```

No test suite exists yet. No CI/CD pipeline is configured.

## Database Schema (Supabase / PostgreSQL)

Tables inferred from API route queries:

| Table | Purpose |
|-------|---------|
| `cases` | Litigation case records (id, entity, docket_number, case_name, case_type, court_name, status, nature_of_suit, cause_of_action, demand, judge, plaintiffs, defendants, attorneys, complaint_text, complaint_summary, blaw_url, filed, updated, date_logged) |
| `case_chunks` | Complaint text chunks with pgvector embeddings (used by `match_case_chunks` RPC) |
| `consultant_results` | Per-case viability + top-3 consultant rankings with scores and explanations |
| `user_reactions` | Like (+1) / dislike (-1) per user per case |
| `user_favorites` | Saved cases per user |
| `user_settings` | Encrypted API key, model preference, bio_text |
| `user_narratives` | Free-text feedback per user per case (upsert on conflict user_id,case_id) |
| `preference_signals` | Extracted signals: dimension, entity, score per narrative |
| `user_preference_profile` | Aggregated: dimension, entity, cumulative_score, mention_count, avg_score |
| `user_dimension_weights` | Per-dimension weight as proportion of total mentions |

**RPC**: `match_case_chunks(query_embedding, match_threshold, match_count)` — pgvector similarity search.

### Sentinel Values

Complaint summaries with these values are filtered out everywhere:
```ts
['No complaint found', 'ERROR', 'Failed to fetch pleadings.', '']
```
This constant is defined in `src/app/api/search/route.ts` as `SENTINEL_VALUES` and as `VALID_SUMMARY_FILTER` in `src/lib/types.ts` (Supabase PostgREST filter string).

## Authentication & Middleware

- Auth is **email/password** via Supabase Auth.
- Sessions are cookie-based using `@supabase/ssr`.
- `src/middleware.ts` protects `/dashboard`, `/search`, `/cases`, `/settings` — unauthenticated users redirect to `/auth`. Authenticated users on `/auth` redirect to `/dashboard`.
- Middleware is excluded from `_next/static`, `_next/image`, `favicon.ico`, and `api/` routes.
- Use `createServerSupabaseClient()` from `src/lib/supabase-server.ts` in API routes and Server Components.
- Use `createBrowserSupabaseClient()` from `src/lib/supabase-browser.ts` in Client Components.

## Personalization Engine (`src/lib/personalization.ts`)

This is the core ranking logic. Understand it before modifying anything that affects search results or the dashboard feed.

### Scoring Dimensions

```ts
const DEFAULT_DIMENSION_WEIGHTS = {
  firm: 0.15,
  attorney: 0.15,
  client: 0.10,
  practice_area: 0.15,
  case_type: 0.10,
  jurisdiction: 0.10,
  judge: 0.10,
  topic: 0.15,   // matched against complaint_summary via keyword overlap
};
```

### Cold-Start Behavior

- `COLD_START_THRESHOLD = 3` narratives.
- **< 3 narratives**: Bio dominates scoring (bio weight 70%, feedback 30%).
- **≥ 3 narratives**: Feedback dominates; `feedbackWeight = min(0.8, 0.5 + (N - 3) * 0.03)`.

### Base vs Personal Blending (alpha/beta)

| Narratives | Base (alpha) | Personal (beta) |
|------------|-------------|----------------|
| < 3 | 0.7 | 0.3 |
| ≥ 3 | 0.7 | 0.3 |
| > 10 | 0.5 | 0.5 |
| > 25 | 0.4 | 0.6 |
| > 50 | 0.3 | 0.7 |

### Topic Scoring

Topic signals match against `complaint_summary` using word-level overlap. A match requires ≥ 50% of topic words to appear in the summary.

### Bio Scoring

Bio text is tokenized, stop words removed, then matched against case text (complaint_summary + metadata). Minimum match: 5% overlap AND ≥ 2 words. Score = `min(1.0, matchRatio * 3)`.

### Profile Rebuild Strategy

When a narrative is updated, `rebuildPreferenceProfile()` in `src/app/api/narrative/route.ts` fully clears and reconstructs `user_preference_profile` and `user_dimension_weights` from all `preference_signals`. This is intentional — it handles edits correctly at the cost of slightly more DB writes.

## API Routes

### `POST /api/search`
1. Gets session (401 if unauthenticated)
2. Generates embedding via HuggingFace (`BAAI/bge-large-en-v1.5`)
3. Calls `match_case_chunks` RPC (threshold 0.3, top 20 chunks → deduplicated to top 10 cases)
4. Falls back to Supabase `ilike` text search if embedding fails
5. Fetches full case data + user reactions
6. Reranks with `rerankWithProfile()` using profile + bio
7. Optionally calls Gemini for a 2-3 paragraph synthesis (requires user API key)

### `POST /api/react`
Records a like (+1) or dislike (-1) reaction. Also extracts feature signals from the case metadata and updates preference weights (legacy path — the newer narrative flow is more powerful).

### `GET /api/settings` / `PUT /api/settings`
Manages `user_settings` table. API keys are always stored encrypted (AES-256-GCM) and never returned in plaintext — only a masked version (`ABCD...WXYZ`) is returned.

### `GET /api/narrative?case_id=X`
Returns the user's existing narrative text and extracted signals for a case.

### `POST /api/narrative`
1. Saves/updates narrative in `user_narratives`
2. Deletes old signals for that case
3. Calls Gemini with structured prompt to extract `ExtractedSignal[]` (dimension, entity, score -1 to 1)
4. Saves signals to `preference_signals`
5. Calls `rebuildPreferenceProfile()` to reconstruct the full profile

## TypeScript Conventions

- All interfaces are in `src/lib/types.ts` — add new shared types there.
- Path alias `@/*` maps to `./src/*` (configured in `tsconfig.json`).
- Strict mode is enabled — avoid `any` where possible, though some Supabase response types use it.
- The `GEMINI_MODELS` constant in `types.ts` is the single source of truth for valid model IDs. Add new models there.

## Tailwind / Styling Conventions

- **Brand colors**: Use `themis-{50..950}` scale (blue-teal palette). Primary actions use `themis-600`/`themis-700`.
- **Gold accents**: `gold-400`/`gold-500` for favorites/stars.
- **Viability badges**: `viability-high` (green), `viability-medium` (amber), `viability-low` (red).
- **Fonts**: `font-display` (DM Serif Display) for headings, `font-body` (DM Sans) for body, `font-mono` (JetBrains Mono) for code/data.
- **Animations**: `animate-fade-in`, `animate-slide-up`, `animate-slide-down` are defined and available.
- No CSS Modules — all styling is utility-class Tailwind in JSX.

## Security Considerations

- **Never return decrypted API keys** in any API response. Only masked keys (`ABCD...WXYZ`) should be returned.
- **Never log API keys** even in development.
- `API_KEY_ENCRYPTION_SECRET` must be 32 bytes (64 hex chars). The fallback (SHA-256 of anon key) is weaker — always set the explicit secret in production.
- All API routes check for an authenticated session before processing. A missing or invalid session returns 401.
- User data is always scoped by `user_id` from the server-side session — never trust a `user_id` from the request body.
- Gemini prompts include case metadata — be careful about prompt injection if case data is user-generated.

## Data Pipeline (Offline)

Cases are populated via an offline Jupyter notebook (`Themis.ipynb`, not in this repo):

1. Case tracker → `docket_db.csv`
2. Complaint extraction + Gemini summarization → `cases.csv`
3. Consultant matching + LLM ranking → `results.csv`
4. Supabase upsert (cases, case_chunks with embeddings, consultant_results)

The web app is read-only with respect to the case data — it never creates or modifies case records.

## Known Gaps / Technical Debt

- **No test suite**: No Jest, Vitest, or testing setup exists. When adding tests, Vitest with React Testing Library is the recommended choice for this stack.
- **No CI/CD**: Deployments are manual (Vercel git integration). Consider adding GitHub Actions for lint + type-check on PRs.
- **Legacy exports in `personalization.ts`**: `extractCaseFeatures()` and `rerankCases()` at the bottom of the file are stubs kept for backward compatibility. They do nothing and can be removed when confirmed safe.
- **`src/app/middleware.ts`**: Appears to be a stale duplicate of `src/middleware.ts`. Should be removed to avoid confusion.
- **Sequential DB writes in `updatePreferenceProfile()`**: The function in `narrative/route.ts` iterates signals with `await` in a loop. For large signal sets this is slow — could be parallelized with `Promise.all`.
- **No rate limiting**: API routes have no rate limiting on Gemini calls — a user could trigger many expensive requests.
- **`any` types in Supabase responses**: Several API routes cast Supabase results to `any`. Consider generating types with `supabase gen types typescript`.

## Adding New Features — Key Patterns

### New API Route
```ts
// src/app/api/your-feature/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Always scope DB queries by session.user.id
}
```

### New Page (App Router)
- Server Components by default — add `'use client'` only when needed (event handlers, useState, useEffect).
- Protected routes are automatically handled by `src/middleware.ts` — add new protected paths to the `isProtectedRoute` array there.

### New Preference Dimension
1. Add to `DIMENSIONS` const in `src/app/api/narrative/route.ts`
2. Add default weight to `DEFAULT_DIMENSION_WEIGHTS` in `src/lib/personalization.ts`
3. Add dimension extraction logic to `extractCaseDimensions()` in `personalization.ts`
4. Update Gemini extraction prompt in `narrative/route.ts` to include the new dimension

### New Gemini Model
Add to `GEMINI_MODELS` array in `src/lib/types.ts`. The settings page and API routes read from this constant.
