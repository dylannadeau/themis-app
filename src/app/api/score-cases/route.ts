import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { decrypt } from '@/lib/encryption';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const BATCH_SIZE = 5;

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

function buildScoringPrompt(
  bioText: string,
  profileEntries: ProfileEntry[],
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

Score each case from 1 to 10 based ONLY on expertise and interest alignment — how well this case matches what this professional knows and cares about. Do NOT factor in commercial viability (that is scored separately).

- 8-10: Strong expertise match — case directly aligns with professional's domain knowledge, practice areas, or demonstrated interests
- 5-7: Partial match — some overlap with professional's background or adjacent to their expertise
- 2-4: Weak connection — tangentially related at best
- 1: No meaningful connection to this professional's expertise

Cases to score:

${casesSection}

Respond ONLY with a JSON array, no markdown fences:
[{"case_id": "...", "score": N, "reasoning": "one sentence"}]`;
}

async function callGemini(
  prompt: string,
  apiKey: string,
  model: string
): Promise<string | null> {
  const response = await fetch(
    `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.1,
        },
      }),
    }
  );

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error(`Gemini API error (${response.status}):`, errBody);
    return null;
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
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
    console.error('Failed to parse Gemini scoring response:', cleaned);
    return [];
  }
}

async function getUserSettings(supabase: ReturnType<typeof createServerSupabaseClient>, userId: string) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('api_key_encrypted, model_preference, bio_text')
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
    const { mode, case_ids } = body as {
      mode: 'cluster' | 'direct';
      case_ids?: string[];
    };

    if (!mode || !['cluster', 'direct'].includes(mode)) {
      return NextResponse.json(
        { error: 'mode must be "cluster" or "direct"' },
        { status: 400 }
      );
    }

    // Fetch user settings
    const settings = await getUserSettings(supabase, userId);
    if (!settings?.bio_text) {
      return NextResponse.json(
        { error: 'Add your professional bio in Settings to enable scoring.' },
        { status: 400 }
      );
    }

    if (!settings.api_key_encrypted) {
      return NextResponse.json(
        { error: 'Add your Gemini API key in Settings to enable scoring.' },
        { status: 400 }
      );
    }

    let apiKey: string;
    try {
      apiKey = decrypt(settings.api_key_encrypted);
    } catch {
      return NextResponse.json(
        { error: 'Failed to decrypt API key. Please re-enter it in Settings.' },
        { status: 400 }
      );
    }

    const model = settings.model_preference || DEFAULT_MODEL;
    const bioText = settings.bio_text;
    const profileEntries = await getUserProfile(supabase, userId);

    if (mode === 'cluster') {
      return handleClusterScoring(supabase, userId, apiKey, model, bioText, profileEntries);
    } else {
      return handleDirectScoring(
        supabase,
        userId,
        apiKey,
        model,
        bioText,
        profileEntries,
        case_ids
      );
    }
  } catch (err: unknown) {
    console.error('POST /api/score-cases error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleClusterScoring(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
  apiKey: string,
  model: string,
  bioText: string,
  profileEntries: ProfileEntry[]
) {
  // Step 2: Fetch cluster representatives
  const { data: representatives, error: repError } = await supabase
    .from('case_clusters')
    .select('case_id, cluster_id')
    .eq('is_representative', true);

  if (repError || !representatives || representatives.length === 0) {
    return NextResponse.json(
      { error: 'No clusters found. Run clustering first via POST /api/admin/cluster-cases.' },
      { status: 400 }
    );
  }

  // Step 3: Skip reps that already have non-stale scores
  const repCaseIds = representatives.map((r: { case_id: string }) => r.case_id);

  const { data: existingScores } = await supabase
    .from('user_case_scores')
    .select('case_id')
    .eq('user_id', userId)
    .eq('stale', false)
    .in('case_id', repCaseIds);

  const scoredCaseIds = new Set(
    (existingScores || []).map((s: { case_id: string }) => s.case_id)
  );
  const unscoredReps = representatives.filter(
    (r: { case_id: string }) => !scoredCaseIds.has(r.case_id)
  );

  if (unscoredReps.length === 0) {
    // All reps scored — still propagate to cluster members
    const propagationResult = await propagateAllScores(
      supabase,
      userId,
      representatives
    );
    return NextResponse.json({
      success: true,
      representatives_scored: 0,
      representatives_already_scored: repCaseIds.length,
      total_cases_scored: propagationResult.totalPropagated,
      message: 'All representatives already scored. Propagated to cluster members.',
    });
  }

  // Step 4: Fetch case data for unscored reps
  const unscoredCaseIds = unscoredReps.map((r: { case_id: string }) => r.case_id);
  const { data: casesData, error: casesError } = await supabase
    .from('cases')
    .select('id, case_name, complaint_summary, court_name, filed, nature_of_suit, cause_of_action')
    .in('id', unscoredCaseIds);

  if (casesError || !casesData) {
    return NextResponse.json(
      { error: `Failed to fetch case data: ${casesError?.message}` },
      { status: 500 }
    );
  }

  // Step 7: Call Gemini in batches of 5 reps
  const allScores: ScoreResult[] = [];
  const errors: string[] = [];

  for (let i = 0; i < casesData.length; i += BATCH_SIZE) {
    const batch = casesData.slice(i, i + BATCH_SIZE) as CaseData[];
    const prompt = buildScoringPrompt(bioText, profileEntries, batch);

    let scores = await callGeminiAndParse(prompt, apiKey, model);

    // Retry once on failure
    if (scores.length === 0 && batch.length > 0) {
      await sleep(1000);
      scores = await callGeminiAndParse(prompt, apiKey, model);
      if (scores.length === 0) {
        errors.push(
          `Failed to score batch starting at case ${batch[0].id} after retry`
        );
        continue;
      }
    }

    allScores.push(...scores);

    // Small delay between batches
    if (i + BATCH_SIZE < casesData.length) {
      await sleep(300);
    }
  }

  // Upsert representative scores
  for (const score of allScores) {
    const { error: upsertError } = await supabase
      .from('user_case_scores')
      .upsert(
        {
          user_id: userId,
          case_id: score.case_id,
          score: score.score,
          reasoning: score.reasoning,
          source: 'cluster',
          stale: false,
          scored_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,case_id' }
      );

    if (upsertError) {
      errors.push(`Failed to upsert score for ${score.case_id}: ${upsertError.message}`);
    }
  }

  // Step 8: Propagate to cluster members
  const propagationResult = await propagateAllScores(
    supabase,
    userId,
    representatives
  );

  return NextResponse.json({
    success: true,
    representatives_scored: allScores.length,
    total_cases_scored: allScores.length + propagationResult.totalPropagated,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

async function callGeminiAndParse(
  prompt: string,
  apiKey: string,
  model: string
): Promise<ScoreResult[]> {
  const text = await callGemini(prompt, apiKey, model);
  if (!text) return [];
  return parseScores(text);
}

async function propagateAllScores(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
  representatives: { case_id: string; cluster_id: number }[]
) {
  let totalPropagated = 0;

  for (const rep of representatives) {
    // Get rep's score
    const { data: repScore } = await supabase
      .from('user_case_scores')
      .select('score, reasoning')
      .eq('user_id', userId)
      .eq('case_id', rep.case_id)
      .eq('stale', false)
      .single();

    if (!repScore) continue;

    // Get cluster members
    const { data: members } = await supabase
      .from('case_clusters')
      .select('case_id, distance_to_representative, is_representative')
      .eq('cluster_id', rep.cluster_id);

    if (!members || members.length <= 1) continue;

    // Compute median distance
    const memberDistances = members
      .filter(
        (m: { is_representative: boolean; distance_to_representative: number | null }) =>
          !m.is_representative && m.distance_to_representative != null
      )
      .map(
        (m: { distance_to_representative: number }) =>
          m.distance_to_representative
      )
      .sort((a: number, b: number) => a - b);

    const medianDist =
      memberDistances.length > 0
        ? memberDistances[Math.floor(memberDistances.length / 2)]
        : 0;

    // Propagate scores to non-representative members
    for (const member of members) {
      if (member.is_representative) continue;

      const dist = member.distance_to_representative ?? 0;
      const memberScore =
        dist <= medianDist
          ? repScore.score
          : Math.max(1, repScore.score - 1);

      const { error: upsertError } = await supabase
        .from('user_case_scores')
        .upsert(
          {
            user_id: userId,
            case_id: member.case_id,
            score: memberScore,
            reasoning: `Propagated from cluster representative (distance: ${dist.toFixed(3)})`,
            source: 'cluster',
            stale: false,
            scored_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,case_id' }
        );

      if (!upsertError) {
        totalPropagated++;
      }
    }
  }

  return { totalPropagated };
}

async function handleDirectScoring(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
  apiKey: string,
  model: string,
  bioText: string,
  profileEntries: ProfileEntry[],
  caseIds?: string[]
) {
  if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
    return NextResponse.json(
      { error: 'case_ids array is required for direct mode' },
      { status: 400 }
    );
  }

  if (caseIds.length > 10) {
    return NextResponse.json(
      { error: 'Maximum 10 cases for direct scoring' },
      { status: 400 }
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
      { status: 500 }
    );
  }

  const allScores: ScoreResult[] = [];
  const errors: string[] = [];

  // Score one case per Gemini call for precision
  for (const caseItem of casesData as CaseData[]) {
    const prompt = buildScoringPrompt(bioText, profileEntries, [caseItem]);
    let scores = await callGeminiAndParse(prompt, apiKey, model);

    // Retry once on failure
    if (scores.length === 0) {
      await sleep(1000);
      scores = await callGeminiAndParse(prompt, apiKey, model);
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
        { onConflict: 'user_id,case_id' }
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
