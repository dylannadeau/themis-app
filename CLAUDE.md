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
│   │   ├── admin/
│   │   │   └── generate-embeddings/route.ts  # POST: generate case chunk embeddings
│   │   ├── narrative/route.ts    # GET/POST: narrative save + Gemini signal extraction
│   │   ├── preferences/route.ts  # GET/DELETE/PATCH: manage preference profile entries
│   │   ├── react/route.ts        # POST: like/dislike tracking + preference signal creation
│   │   ├── score-cases/route.ts  # POST: Gemini-powered case relevance scoring
│   │   ├── search/route.ts       # POST: vector search → rerank → Gemini synthesis
│   │   └── settings/route.ts     # GET/PUT: API key (encrypted), model, bio
│   ├── auth/page.tsx             # Sign in / sign up page
│   ├── cases/[id]/page.tsx       # Case detail, viability, reactions, narrative feedback
│   ├── dashboard/page.tsx        # Personalized case feed with filters and interaction tabs
│   ├── preferences/page.tsx      # View/edit preference profile, dimension weights
│   ├── search/page.tsx           # RAG search interface with auto-scoring
│   ├── settings/page.tsx         # BYOK key, model selection, bio upload
│   ├── layout.tsx                # Root layout (fonts, globals)
│   ├── page.tsx                  # Root → redirects to /dashboard
│   ├── globals.css               # Tailwind base + custom CSS
│   └── middleware.ts             # IMPORTANT: this is unused (see src/middleware.ts)
├── components/
│   ├── AppShell.tsx              # Sticky nav, mobile menu, sign-out
│   ├── CaseCard.tsx              # Case preview: score badge, reactions, favorites, narrative toggle
│   ├── ExplainabilityTags.tsx    # Badges showing which preferences/bio boosted ranking
│   ├── FilterPanel.tsx           # Collapsible sidebar: NOS, date, source, favorites
│   ├── InteractionTabs.tsx       # Tab filter: new / liked / disliked / reviewed / all
│   ├── NarrativeFeedback.tsx     # Textarea for feedback with signal extraction UI
│   ├── NewUserSetupModal.tsx     # Onboarding modal for bio/API key/model setup
│   ├── ScoreCasesModal.tsx       # Modal to batch-score cases with filtering options
│   └── Toast.tsx                 # Toast notification system with auto-dismiss
├── lib/
│   ├── encryption.ts             # AES-256-GCM encrypt/decrypt for API keys
│   ├── personalization.ts        # Core reranking logic (see Personalization section)
│   ├── preference-utils.ts       # Profile rebuild, reaction signals, score staleness
│   ├── supabase-browser.ts       # Client-side Supabase (singleton)
│   ├── supabase-server.ts        # Server-side Supabase with SSR cookie handling
│   └── types.ts                  # All TypeScript interfaces + GEMINI_MODELS constant
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

### `cases`
Primary case data, synced from offline notebook. The web app never creates or modifies case records.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | text | NO | PK, Bloomberg docket ID |
| entity | text | YES | Company/firm/keyword that matched |
| source | text | YES | Search source type |
| docket_number | text | YES | |
| filed | date | YES | |
| updated | date | YES | |
| case_name | text | NO | |
| case_type | text | YES | |
| court_name | text | YES | |
| status | text | YES | |
| nature_of_suit | text | YES | Data quality issues — don't rely on for logic |
| cause_of_action | text | YES | Data quality issues — don't rely on for logic |
| demand | text | YES | |
| judge | text | YES | |
| plaintiffs | jsonb | YES | Array of names |
| defendants | jsonb | YES | Array of names |
| attorneys | jsonb | YES | Array of names |
| complaint_text | text | YES | Raw complaint PDF text |
| complaint_summary | text | YES | Gemini-generated 2-paragraph summary |
| blaw_url | text | YES | Bloomberg Law link |
| date_logged | timestamptz | YES | |
| case_viability | text | YES | 'high', 'medium', 'low' — set by notebook |
| viability_reasoning | text | YES | One sentence explanation |
| viability_scored_at | timestamptz | YES | |

### `case_chunks`
Embedding chunks for RAG search. Generated by `/api/admin/generate-embeddings`.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | bigint | NO | PK |
| case_id | text | YES | FK → cases.id |
| chunk_index | integer | NO | |
| chunk_text | text | NO | |
| section_type | text | YES | |
| embedding | vector(1024) | YES | BAAI/bge-large-en-v1.5 |
| metadata | jsonb | YES | |

### `user_settings`
Per-user configuration. Supports multiple AI providers (BYOK for Gemini and/or Anthropic).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| user_id | uuid | NO | PK, FK → auth.users |
| api_key_encrypted | text | YES | AES-256 encrypted Gemini key |
| api_key_masked | text | YES | Display version (last 4 chars) |
| anthropic_key_encrypted | text | YES | AES-256 encrypted Anthropic key |
| anthropic_key_masked | text | YES | Display version (last 4 chars) |
| ai_provider | text | YES | 'gemini' or 'anthropic' (default: 'gemini') |
| model_preference | text | YES | Model ID to use (provider-specific) |
| bio_text | text | YES | Professional bio for scoring |
| bio_updated_at | timestamptz | YES | |
| created_at | timestamptz | YES | |
| updated_at | timestamptz | YES | |

### `user_case_scores`
Per-user relevance scores. One row per user-case pair.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid | NO | PK |
| user_id | uuid | NO | FK → auth.users |
| case_id | text | NO | FK → cases.id |
| score | integer | NO | 1-10, CHECK constraint |
| reasoning | text | YES | One sentence from Gemini |
| source | text | NO | Always 'direct' |
| stale | boolean | YES | True after preference changes |
| scored_at | timestamptz | YES | |
| | | | UNIQUE(user_id, case_id) |

### `user_reactions`
Like/dislike on cases. 1 = like, -1 = dislike.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | bigint | NO | PK |
| user_id | uuid | YES | FK → auth.users |
| case_id | text | YES | FK → cases.id |
| reaction | smallint | NO | 1 or -1 |
| created_at | timestamptz | YES | |

### `user_narratives`
Free-text feedback on cases. Upsert on conflict (user_id, case_id).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | bigint | NO | PK |
| user_id | uuid | NO | FK → auth.users |
| case_id | text | NO | FK → cases.id |
| narrative | text | NO | User's written feedback |
| created_at | timestamptz | YES | |
| updated_at | timestamptz | YES | |

### `preference_signals`
Individual preference data points extracted from reactions and narratives.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | bigint | NO | PK |
| user_id | uuid | NO | FK → auth.users |
| narrative_id | bigint | NO | FK → user_narratives.id |
| case_id | text | NO | FK → cases.id |
| dimension | text | NO | e.g. 'practice_area', 'firm', 'jurisdiction', 'judge', 'topic' |
| entity | text | NO | The extracted value |
| score | numeric | NO | Weighted signal strength |
| source | text | NO | 'narrative' or 'reaction' |
| created_at | timestamptz | YES | |

### `user_preference_profile`
Aggregated preference profile, rebuilt from all signals after each interaction.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | bigint | NO | PK |
| user_id | uuid | NO | FK → auth.users |
| dimension | text | NO | |
| entity | text | NO | |
| cumulative_score | numeric | YES | Sum of signal scores |
| mention_count | integer | YES | Number of signals |
| avg_score | numeric | YES | cumulative_score / mention_count |
| updated_at | timestamptz | YES | |

### `user_dimension_weights`
How important each dimension is for a user, based on proportion of total mentions.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | bigint | NO | PK |
| user_id | uuid | NO | FK → auth.users |
| dimension | text | NO | |
| total_mentions | integer | YES | |
| weight | numeric | YES | total_mentions / grand total |
| updated_at | timestamptz | YES | |

### `user_favorites`
Bookmarked cases.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | bigint | NO | PK |
| user_id | uuid | YES | FK → auth.users |
| case_id | text | YES | FK → cases.id |
| created_at | timestamptz | YES | |

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

When a narrative is updated, `rebuildPreferenceProfile()` in `src/lib/preference-utils.ts` fully clears and reconstructs `user_preference_profile` and `user_dimension_weights` from all `preference_signals`. It computes `avg_score = cumulative_score / mention_count` for each entity. This is intentional — it handles edits correctly at the cost of slightly more DB writes.

## Preference Utilities (`src/lib/preference-utils.ts`)

Shared functions used by the narrative and react API routes:

- **`rebuildPreferenceProfile(supabase, userId)`** — Clears and reconstructs `user_preference_profile` and `user_dimension_weights` from all `preference_signals`. Computes cumulative_score, mention_count, and avg_score per dimension/entity pair.
- **`createReactionSignals(supabase, userId, caseId, reaction)`** — Generates preference signals from a like/dislike by mapping case metadata (firm, practice_area, jurisdiction, judge) to signals with attenuated scores.
- **`deleteReactionSignals(supabase, userId, caseId)`** — Removes reaction-sourced signals for a user+case.
- **`markScoresStale(supabase, userId)`** — Marks all `user_case_scores` as stale after preference changes, triggering re-scoring on next view.

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
Records a like (+1) or dislike (-1) reaction. Creates/deletes preference signals from case metadata via `createReactionSignals()` / `deleteReactionSignals()`, then rebuilds the full preference profile and marks scores stale.

### `POST /api/score-cases`
Scores cases for relevance to the user's professional expertise using Gemini. Accepts `{ case_ids: string[] }` (max 10). Uses bio text, preference profile, and recent narratives to build a scoring prompt. Scores each case 1-10 and upserts results into `user_case_scores`. Auto-triggered by the dashboard and search page for unscored cases.

### `GET /api/preferences`
Returns the user's full preference profile (dimension/entity/scores), dimension weights, and narrative count.

### `DELETE /api/preferences`
Removes a specific entity from the preference profile and its underlying signals. Recalculates dimension weights.

### `PATCH /api/preferences`
Manually adjusts the avg_score for a specific dimension/entity in the profile.

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
6. Calls `markScoresStale()` to invalidate existing scores

## Dashboard Behavior

The dashboard (`src/app/dashboard/page.tsx`) has several important behaviors:

- **Pagination**: Loads 50 cases at a time (by filed date desc) with infinite scroll.
- **Interacted cases**: After loading the initial page, the dashboard fetches any liked/disliked/reviewed cases that fall outside the initial page. This ensures all interacted cases always appear in their respective tabs.
- **Interaction tabs**: Cases are categorized into new / liked / disliked / reviewed / all. The "new" tab filters out any case the user has interacted with.
- **Auto-scoring**: Unscored cases can be batch-scored via the ScoreCasesModal, which supports filtering by viability, date range, and keyword.
- **Score sorting**: Scored cases sort first (by score desc), then unscored by filed date desc.

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
3. Viability assessment → `case_viability` and `viability_reasoning` fields on `cases` table
4. Supabase upsert (cases, case_chunks with embeddings)

The web app is read-only with respect to the case data — it never creates or modifies case records.

## Known Gaps / Technical Debt

- **No test suite**: No Jest, Vitest, or testing setup exists. When adding tests, Vitest with React Testing Library is the recommended choice for this stack.
- **No CI/CD**: Deployments are manual (Vercel git integration). Consider adding GitHub Actions for lint + type-check on PRs.
- **`src/app/middleware.ts`**: Appears to be a stale duplicate of `src/middleware.ts`. Should be removed to avoid confusion.
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
