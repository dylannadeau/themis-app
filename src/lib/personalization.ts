import { CaseWithResult, UserPreference } from './types';

const FEATURE_KEYS = ['nature_of_suit', 'cause_of_action', 'entity', 'source', 'court_name', 'judge'] as const;

/**
 * Extract metadata features from a case for preference matching
 */
export function extractCaseFeatures(caseData: CaseWithResult): { key: string; value: string }[] {
  const features: { key: string; value: string }[] = [];

  for (const key of FEATURE_KEYS) {
    const value = caseData[key as keyof CaseWithResult];
    if (typeof value === 'string' && value.trim()) {
      features.push({ key, value: value.trim() });
    }
  }

  return features;
}

/**
 * Compute personalization score for a case based on user preferences
 */
export function computePersonalizationScore(
  caseData: CaseWithResult,
  preferences: UserPreference[]
): number {
  if (preferences.length === 0) return 0;

  const prefMap = new Map<string, number>();
  for (const pref of preferences) {
    prefMap.set(`${pref.feature_key}::${pref.feature_value}`, pref.weight);
  }

  const features = extractCaseFeatures(caseData);
  let score = 0;

  for (const { key, value } of features) {
    const weight = prefMap.get(`${key}::${value}`);
    if (weight !== undefined) {
      score += weight;
    }
  }

  return score;
}

/**
 * Rerank cases by blending base relevance with personalization
 */
export function rerankCases(
  cases: CaseWithResult[],
  preferences: UserPreference[],
  alpha: number = 0.8,
  beta: number = 0.2
): CaseWithResult[] {
  // Adjust beta based on total reactions (preference entries as proxy)
  const totalReactions = preferences.reduce((sum, p) => sum + Math.abs(p.weight), 0);
  if (totalReactions > 20) {
    alpha = 0.7;
    beta = 0.3;
  }
  if (totalReactions > 50) {
    alpha = 0.6;
    beta = 0.4;
  }

  const scored = cases.map((c, index) => {
    // Base relevance: inverse of position (first = highest)
    const baseScore = (cases.length - index) / cases.length;
    const persScore = computePersonalizationScore(c, preferences);

    // Normalize personalization score
    const maxPossiblePers = Math.max(1, ...cases.map(cc => Math.abs(computePersonalizationScore(cc, preferences))));
    const normalizedPers = maxPossiblePers > 0 ? persScore / maxPossiblePers : 0;

    return {
      ...c,
      relevance_score: (baseScore * alpha) + (normalizedPers * beta),
    };
  });

  return scored.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
}

/**
 * Compute preference weight updates for a reaction
 */
export function computePreferenceUpdates(
  caseData: CaseWithResult,
  reaction: 1 | -1,
  previousReaction?: 1 | -1 | null
): { feature_key: string; feature_value: string; delta: number }[] {
  const features = extractCaseFeatures(caseData);
  const updates: { feature_key: string; feature_value: string; delta: number }[] = [];

  for (const { key, value } of features) {
    let delta = reaction;

    // If changing reaction, reverse the previous one too
    if (previousReaction) {
      delta = reaction - previousReaction; // e.g., from -1 to +1 = +2
    }

    if (delta !== 0) {
      updates.push({ feature_key: key, feature_value: value, delta });
    }
  }

  return updates;
}
