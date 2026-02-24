import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { decrypt } from '@/lib/encryption';

const DIMENSIONS = ['firm', 'attorney', 'client', 'practice_area', 'case_type', 'jurisdiction', 'judge', 'topic'] as const;

interface ExtractedSignal {
  dimension: string;
  entity: string;
  score: number;
}

/**
 * Extract structured preference signals from a narrative using Gemini
 */
async function extractPreferences(
  narrative: string,
  caseMetadata: Record<string, any>,
  apiKey: string,
  modelId: string
): Promise<ExtractedSignal[]> {
  const prompt = `You are analyzing user feedback about a legal case to extract sentiment signals.

Given this case metadata:
- Case Name: ${caseMetadata.case_name || 'N/A'}
- Court: ${caseMetadata.court_name || 'N/A'}
- Nature of Suit: ${caseMetadata.nature_of_suit || 'N/A'}
- Cause of Action: ${caseMetadata.cause_of_action || 'N/A'}
- Judge: ${caseMetadata.judge || 'N/A'}
- Entity/Source: ${caseMetadata.entity || 'N/A'}
- Plaintiffs: ${JSON.stringify(caseMetadata.plaintiffs || [])}
- Defendants: ${JSON.stringify(caseMetadata.defendants || [])}
- Attorneys: ${JSON.stringify(caseMetadata.attorneys || [])}
- Complaint Summary: ${(caseMetadata.complaint_summary || 'N/A').slice(0, 800)}

And this user feedback:
"${narrative}"

Extract sentiment for each dimension mentioned in the feedback. Only include dimensions the user actually commented on. Use a score from -1.0 (strong negative) to 1.0 (strong positive).

IMPORTANT: In addition to entity-level dimensions, extract "topic" signals when the user expresses interest in the subject matter, legal theory, or type of dispute. Topic entities should be short descriptive phrases (3-6 words) that capture the legal theme, e.g. "FCRA credit reporting violations", "semiconductor patent infringement", "employment discrimination class action". These topics will be matched against complaint summaries of other cases.

Respond ONLY with a JSON array, no markdown, no explanation. Each item should have:
- "dimension": one of "firm", "attorney", "client", "practice_area", "case_type", "jurisdiction", "judge", "topic"
- "entity": the specific entity name or topic phrase
- "score": number between -1.0 and 1.0

Example response:
[{"dimension":"firm","entity":"WilmerHale","score":0.85},{"dimension":"attorney","entity":"Jane Smith","score":-0.6},{"dimension":"topic","entity":"FCRA credit reporting violations","score":0.9}]

If the user didn't express sentiment about any dimension, respond with an empty array: []`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.1,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

  // Clean up response - strip markdown fences if present
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    const signals: ExtractedSignal[] = JSON.parse(cleaned);
    // Validate and clamp scores
    return signals
      .filter(
        (s) =>
          DIMENSIONS.includes(s.dimension as any) &&
          typeof s.entity === 'string' &&
          s.entity.trim() &&
          typeof s.score === 'number'
      )
      .map((s) => ({
        dimension: s.dimension,
        entity: s.entity.trim(),
        score: Math.max(-1, Math.min(1, s.score)),
      }));
  } catch {
    console.error('Failed to parse Gemini extraction:', cleaned);
    return [];
  }
}

/**
 * Update the user's preference profile and dimension weights based on new signals
 */
async function updatePreferenceProfile(
  supabase: any,
  userId: string,
  signals: ExtractedSignal[]
) {
  for (const signal of signals) {
    // Upsert into user_preference_profile
    const { data: existing } = await supabase
      .from('user_preference_profile')
      .select('id, cumulative_score, mention_count')
      .eq('user_id', userId)
      .eq('dimension', signal.dimension)
      .eq('entity', signal.entity)
      .single();

    if (existing) {
      await supabase
        .from('user_preference_profile')
        .update({
          cumulative_score: existing.cumulative_score + signal.score,
          mention_count: existing.mention_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('user_preference_profile').insert({
        user_id: userId,
        dimension: signal.dimension,
        entity: signal.entity,
        cumulative_score: signal.score,
        mention_count: 1,
      });
    }

    // Upsert dimension weights
    const { data: existingWeight } = await supabase
      .from('user_dimension_weights')
      .select('id, total_mentions')
      .eq('user_id', userId)
      .eq('dimension', signal.dimension)
      .single();

    if (existingWeight) {
      await supabase
        .from('user_dimension_weights')
        .update({
          total_mentions: existingWeight.total_mentions + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingWeight.id);
    } else {
      await supabase.from('user_dimension_weights').insert({
        user_id: userId,
        dimension: signal.dimension,
        total_mentions: 1,
      });
    }
  }

  // Recalculate weights as proportions
  const { data: allWeights } = await supabase
    .from('user_dimension_weights')
    .select('id, total_mentions')
    .eq('user_id', userId);

  if (allWeights && allWeights.length > 0) {
    const totalMentions = allWeights.reduce((sum: number, w: any) => sum + w.total_mentions, 0);
    for (const w of allWeights) {
      await supabase
        .from('user_dimension_weights')
        .update({ weight: totalMentions > 0 ? w.total_mentions / totalMentions : 0 })
        .eq('id', w.id);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { case_id, narrative } = await request.json();
    if (!case_id || !narrative || typeof narrative !== 'string' || !narrative.trim()) {
      return NextResponse.json({ error: 'case_id and narrative are required' }, { status: 400 });
    }

    const userId = session.user.id;

    // Get user's Gemini API key
    const { data: settings } = await supabase
      .from('user_settings')
      .select('api_key_encrypted, model_preference')
      .eq('user_id', userId)
      .single();

    if (!settings?.api_key_encrypted) {
      return NextResponse.json(
        { error: 'Gemini API key required. Add one in Settings.' },
        { status: 400 }
      );
    }

    // Get case metadata
    const { data: caseData } = await supabase
      .from('cases')
      .select('case_name, court_name, nature_of_suit, cause_of_action, judge, entity, plaintiffs, defendants, attorneys, complaint_summary')
      .eq('id', case_id)
      .single();

    if (!caseData) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Save/update narrative
    const { data: savedNarrative, error: narrativeError } = await supabase
      .from('user_narratives')
      .upsert(
        {
          user_id: userId,
          case_id,
          narrative: narrative.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,case_id' }
      )
      .select('id')
      .single();

    if (narrativeError) throw narrativeError;

    // Delete old signals for this narrative (in case of update)
    await supabase
      .from('preference_signals')
      .delete()
      .eq('user_id', userId)
      .eq('case_id', case_id);

    // Extract preferences via Gemini
    const apiKey = decrypt(settings.api_key_encrypted);
    const modelId = settings.model_preference || 'gemini-2.0-flash';

    let signals: ExtractedSignal[] = [];
    try {
      signals = await extractPreferences(narrative.trim(), caseData, apiKey, modelId);
    } catch (err) {
      console.error('Gemini extraction failed:', err);
      // Non-fatal: save narrative but skip extraction
      return NextResponse.json({
        success: true,
        narrative_id: savedNarrative.id,
        signals: [],
        extraction_failed: true,
      });
    }

    // Save signals
    if (signals.length > 0) {
      const signalRows = signals.map((s) => ({
        user_id: userId,
        narrative_id: savedNarrative.id,
        case_id,
        dimension: s.dimension,
        entity: s.entity,
        score: s.score,
      }));

      await supabase.from('preference_signals').insert(signalRows);

      // Rebuild preference profile from ALL signals (not incremental, to handle edits correctly)
      // First, clear the user's profile and rebuild from all signals
      await rebuildPreferenceProfile(supabase, userId);
    }

    return NextResponse.json({
      success: true,
      narrative_id: savedNarrative.id,
      signals,
    });
  } catch (err: any) {
    console.error('Narrative error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET: Fetch user's narrative for a specific case
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const caseId = request.nextUrl.searchParams.get('case_id');
    if (!caseId) {
      return NextResponse.json({ error: 'case_id is required' }, { status: 400 });
    }

    const { data: narrative } = await supabase
      .from('user_narratives')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('case_id', caseId)
      .single();

    const { data: signals } = await supabase
      .from('preference_signals')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('case_id', caseId);

    return NextResponse.json({
      narrative: narrative || null,
      signals: signals || [],
    });
  } catch (err: any) {
    console.error('Narrative GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Rebuild the entire preference profile from all signals (handles edits/deletes correctly)
 */
async function rebuildPreferenceProfile(supabase: any, userId: string) {
  // Clear existing profile
  await supabase.from('user_preference_profile').delete().eq('user_id', userId);
  await supabase.from('user_dimension_weights').delete().eq('user_id', userId);

  // Get all signals
  const { data: allSignals } = await supabase
    .from('preference_signals')
    .select('dimension, entity, score')
    .eq('user_id', userId);

  if (!allSignals || allSignals.length === 0) return;

  // Aggregate into profile
  const profileMap = new Map<string, { cumulative_score: number; mention_count: number }>();
  const dimensionCounts = new Map<string, number>();

  for (const signal of allSignals) {
    const key = `${signal.dimension}::${signal.entity}`;
    const existing = profileMap.get(key) || { cumulative_score: 0, mention_count: 0 };
    existing.cumulative_score += signal.score;
    existing.mention_count += 1;
    profileMap.set(key, existing);

    dimensionCounts.set(signal.dimension, (dimensionCounts.get(signal.dimension) || 0) + 1);
  }

  // Insert profile rows
  const profileRows = [...profileMap.entries()].map(([key, val]) => {
    const [dimension, entity] = key.split('::');
    return {
      user_id: userId,
      dimension,
      entity,
      cumulative_score: val.cumulative_score,
      mention_count: val.mention_count,
    };
  });

  if (profileRows.length > 0) {
    await supabase.from('user_preference_profile').insert(profileRows);
  }

  // Insert dimension weights
  const totalMentions = [...dimensionCounts.values()].reduce((a, b) => a + b, 0);
  const weightRows = [...dimensionCounts.entries()].map(([dimension, count]) => ({
    user_id: userId,
    dimension,
    total_mentions: count,
    weight: totalMentions > 0 ? count / totalMentions : 0,
  }));

  if (weightRows.length > 0) {
    await supabase.from('user_dimension_weights').insert(weightRows);
  }
}
