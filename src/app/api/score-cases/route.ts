import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { generateText, resolveProviderConfig, type AIProviderConfig } from '@/lib/ai-provider';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanJsonResponse(text: string): string {
  return text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
}

interface ScoreResult {
  case_id: string;
  score: number;
  reasoning: string;
}

interface CaseData {
  id: string;
  case_name: string | null;
  complaint_summary: string | null;
  court_name: string | null;
  filed: string | null;
  nature_of_suit: string | null;
  cause_of_action: string | null;
}

interface ProfileEntry {
  dimension: string;
  entity: string;
  avg_score: number;
  mention_count: number;
}

interface NarrativeEntry {
  case_id: string;
  case_name: string | null;
  narrative: string;
}

function buildScoringPrompt(
  bioText: string,
  profileEntries: ProfileEntry[],
  narratives: NarrativeEntry[],
  cases: CaseData[]
): string {
  const profileSection =
    profileEntries.length > 0
      ? profileEntries
          .map(
            (p) =>
              `- ${p.dimension}: ${p.entity} (score: ${p.avg_score.toFixed(2)})`
          )
          .join('\n')
      : 'No feedback history yet.';

  const narrativeSection =
    narratives.length > 0
      ? narratives
          .map((n) => {
            const name = n.case_name || 'Unknown case';
            const text = n.narrative.length > 200 ? n.narrative.slice(0, 200) + '...' : n.narrative;
            return `- Re: ${name}: ${text}`;
          })
          .join('\n')
      : 'No narrative feedback yet.';

  const casesSection = cases
    .map((c, i) => {
      const label = String.fromCharCode(65 + i); // A, B, C...
      const summary = c.complaint_summary
        ? c.complaint_summary.slice(0, 800)
        : 'No summary available';
      return `[Case ${label}] (ID: ${c.id})
${c.case_name || 'Untitled'}
Summary: ${summary}
Court: ${c.court_name || 'Unknown'}
Filed: ${c.filed || 'Unknown'}`;
    })
    .join('\n\n');

  return `You are scoring how relevant litigation cases are to a specific consulting professional's expertise.

Professional Bio:
${bioText}

User's Demonstrated Preferences:
${profileSection}

User's Own Words (recent case feedback — pay close attention to what they find interesting):
${narrativeSection}

Score each case from 1 to 10 based ONLY on expertise and interest alignment — how well this case matches what this professional knows and cares about. Do NOT factor in commercial viability (that is scored separately).

The user's own words above are especially valuable — if they mention specific topics, legal theories, industries, or types of disputes they find interesting, weight those heavily.

- 8-10: Strong expertise match — case directly aligns with professional's domain knowledge, practice areas, or demonstrated interests
- 5-7: Partial match — some overlap with professional's background or adjacent to their expertise
- 2-4: Weak connection — tangentially related at best
- 1: No meaningful connection to this professional's expertise

Cases to score:

${casesSection}

Respond ONLY with a JSON array, no markdown fences:
[{"case_id": "...", "score": N, "reasoning": "one sentence"}]`;
}

async function callAIAndGetText(
  prompt: string,
  config: AIProviderConfig,
): Promise<string | null> {
  return generateText(config, {
    prompt,
    maxOutputTokens: 2048,
    temperature: 0.1,
  });
}

function parseScores(text: string): ScoreResult[] {
  const cleaned = cleanJsonResponse(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item: { case_id?: string; score?: number; reasoning?: string }) =>
          item.case_id &&
          typeof item.score === 'number' &&
          item.score >= 1 &&
          item.score <= 10
      )
      .map((item: { case_id: string; score: number; reasoning?: string }) => ({
        case_id: item.case_id,
        score: Math.round(item.score),
        reasoning: item.reasoning || '',
      }));
  } catch {
    console.error('Failed to parse AI scoring response:', cleaned);
    return [];
  }
}

async function getUserSettings(supabase: ReturnType<typeof createServerSupabaseClient>, userId: string) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('api_key_encrypted, anthropic_key_encrypted, ai_provider, model_preference, bio_text')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data;
}

async function getUserProfile(supabase: ReturnType<typeof createServerSupabaseClient>, userId: string): Promise<ProfileEntry[]> {
  const { data } = await supabase
    .from('user_preference_profile')
    .select('dimension, entity, avg_score, mention_count')
    .eq('user_id', userId)
    .order('mention_count', { ascending: false })
    .limit(15);

  return (data || []) as ProfileEntry[];
}

async function getUserNarratives(supabase: ReturnType<typeof createServerSupabaseClient>, userId: string): Promise<NarrativeEntry[]> {
  const { data: narratives } = await supabase
    .from('user_narratives')
    .select('case_id, narrative')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!narratives || narratives.length === 0) return [];

  // Fetch case names for context
  const caseIds = narratives.map((n: { case_id: string }) => n.case_id);
  const { data: cases } = await supabase
    .from('cases')
    .select('id, case_name')
    .in('id', caseIds);

  const nameMap = new Map((cases || []).map((c: { id: string; case_name: string | null }) => [c.id, c.case_name]));

  return narratives.map((n: { case_id: string; narrative: string }) => ({
    case_id: n.case_id,
    case_name: nameMap.get(n.case_id) || null,
    narrative: n.narrative,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { case_ids } = body as {
      case_ids?: string[];
    };

    // Fetch user settings
    const settings = await getUserSettings(supabase, userId);
    if (!settings?.bio_text) {
      return NextResponse.json(
        { error: 'Add your professional bio in Settings to enable scoring.' },
        { status: 400 },
      );
    }

    const providerConfig = settings ? resolveProviderConfig(settings) : null;
    if (!providerConfig) {
      const hasGeminiKey = !!settings?.api_key_encrypted;
      const hasAnthropicKey = !!settings?.anthropic_key_encrypted;
      const errorDetail = hasGeminiKey || hasAnthropicKey
        ? 'An API key is saved but could not be decrypted. Try re-saving your key in Settings.'
        : 'Add your API key in Settings to enable scoring.';
      return NextResponse.json(
        { error: errorDetail },
        { status: 400 },
      );
    }

    const bioText = settings.bio_text;
    const [profileEntries, narratives] = await Promise.all([
      getUserProfile(supabase, userId),
      getUserNarratives(supabase, userId),
    ]);

    return handleDirectScoring(
      supabase,
      userId,
      providerConfig,
      bioText,
      profileEntries,
      narratives,
      case_ids,
    );
  } catch (err: unknown) {
    console.error('POST /api/score-cases error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function callAIAndParse(
  prompt: string,
  config: AIProviderConfig,
): Promise<ScoreResult[]> {
  const text = await callAIAndGetText(prompt, config);
  if (!text) return [];
  return parseScores(text);
}

async function handleDirectScoring(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
  providerConfig: AIProviderConfig,
  bioText: string,
  profileEntries: ProfileEntry[],
  narratives: NarrativeEntry[],
  caseIds?: string[],
) {
  if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
    return NextResponse.json(
      { error: 'case_ids array is required' },
      { status: 400 },
    );
  }

  if (caseIds.length > 10) {
    return NextResponse.json(
      { error: 'Maximum 10 cases for direct scoring' },
      { status: 400 },
    );
  }

  // Fetch case data
  const { data: casesData, error: casesError } = await supabase
    .from('cases')
    .select('id, case_name, complaint_summary, court_name, filed, nature_of_suit, cause_of_action')
    .in('id', caseIds);

  if (casesError || !casesData) {
    return NextResponse.json(
      { error: `Failed to fetch case data: ${casesError?.message}` },
      { status: 500 },
    );
  }

  const allScores: ScoreResult[] = [];
  const errors: string[] = [];

  // Score one case per AI call for precision
  for (const caseItem of casesData as CaseData[]) {
    const prompt = buildScoringPrompt(bioText, profileEntries, narratives, [caseItem]);
    let scores: ScoreResult[] = [];

    try {
      scores = await callAIAndParse(prompt, providerConfig);
    } catch {
      // Will retry below
    }

    // Retry once on failure
    if (scores.length === 0) {
      await sleep(1000);
      try {
        scores = await callAIAndParse(prompt, providerConfig);
      } catch {
        // Fall through to error
      }
      if (scores.length === 0) {
        errors.push(`Failed to score case ${caseItem.id} after retry`);
        continue;
      }
    }

    allScores.push(...scores);
  }

  // Upsert scores with source = 'direct'
  for (const score of allScores) {
    const { error: upsertError } = await supabase
      .from('user_case_scores')
      .upsert(
        {
          user_id: userId,
          case_id: score.case_id,
          score: score.score,
          reasoning: score.reasoning,
          source: 'direct',
          stale: false,
          scored_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,case_id' },
      );

    if (upsertError) {
      errors.push(`Failed to upsert score for ${score.case_id}: ${upsertError.message}`);
    }
  }

  return NextResponse.json({
    success: true,
    cases_scored: allScores.length,
    scores: allScores,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
