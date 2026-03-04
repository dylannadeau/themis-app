/**
 * Shared preference utilities used by multiple API routes.
 * Extracted from narrative/route.ts to avoid duplication.
 */

interface SignalRow {
  dimension: string;
  entity: string;
  score: number;
}

/**
 * Rebuild the entire preference profile from all preference_signals.
 * Clears and reconstructs user_preference_profile and user_dimension_weights.
 * This handles edits/deletes correctly at the cost of slightly more DB writes.
 */
export async function rebuildPreferenceProfile(supabase: any, userId: string) {
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

  for (const signal of allSignals as SignalRow[]) {
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
      avg_score: val.mention_count > 0 ? val.cumulative_score / val.mention_count : 0,
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

/**
 * Create preference_signals from a like/dislike reaction on a case.
 * Maps case metadata fields to preference dimensions with appropriate scores.
 */
export async function createReactionSignals(
  supabase: any,
  userId: string,
  caseId: string,
  reaction: 1 | -1
) {
  // Fetch case metadata
  const { data: caseData } = await supabase
    .from('cases')
    .select('entity, nature_of_suit, cause_of_action, court_name, judge')
    .eq('id', caseId)
    .single();

  if (!caseData) return;

  const signals: { dimension: string; entity: string; score: number }[] = [];

  if (caseData.entity && caseData.entity.trim()) {
    signals.push({ dimension: 'firm', entity: caseData.entity.trim(), score: reaction * 0.5 });
  }
  if (caseData.nature_of_suit && caseData.nature_of_suit.trim()) {
    signals.push({ dimension: 'practice_area', entity: caseData.nature_of_suit.trim(), score: reaction * 0.5 });
  }
  if (caseData.cause_of_action && caseData.cause_of_action.trim()) {
    signals.push({ dimension: 'practice_area', entity: caseData.cause_of_action.trim(), score: reaction * 0.4 });
  }
  if (caseData.court_name && caseData.court_name.trim()) {
    signals.push({ dimension: 'jurisdiction', entity: caseData.court_name.trim(), score: reaction * 0.3 });
  }
  if (caseData.judge && caseData.judge.trim()) {
    signals.push({ dimension: 'judge', entity: caseData.judge.trim(), score: reaction * 0.3 });
  }

  if (signals.length === 0) return;

  const rows = signals.map((s) => ({
    user_id: userId,
    case_id: caseId,
    dimension: s.dimension,
    entity: s.entity,
    score: s.score,
    source: 'reaction',
  }));

  await supabase.from('preference_signals').insert(rows);
}

/**
 * Delete all reaction-sourced preference_signals for a user+case.
 */
export async function deleteReactionSignals(
  supabase: any,
  userId: string,
  caseId: string
) {
  await supabase
    .from('preference_signals')
    .delete()
    .eq('user_id', userId)
    .eq('case_id', caseId)
    .eq('source', 'reaction');
}

/**
 * Mark all of a user's case scores as stale (e.g. after preference changes).
 */
export async function markScoresStale(supabase: any, userId: string) {
  await supabase
    .from('user_case_scores')
    .update({ stale: true })
    .eq('user_id', userId);
}
