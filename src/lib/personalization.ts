import { CaseWithResult } from './types';

export interface PreferenceProfileEntry {
  dimension: string;
  entity: string;
  cumulative_score: number;
  mention_count: number;
  avg_score: number;
}

export interface DimensionWeight {
  dimension: string;
  total_mentions: number;
  weight: number;
}

export interface ScoreExplanation {
  dimension: string;
  entity: string;
  avg_score: number;
  weighted_contribution: number;
}

export interface ScoredCase extends CaseWithResult {
  personalization_score?: number;
  explanations?: ScoreExplanation[];
}

/**
 * Default dimension weights when user has no history yet.
 * These get overridden by learned weights as soon as the user submits feedback.
 */
const DEFAULT_DIMENSION_WEIGHTS: Record<string, number> = {
  firm: 0.15,
  attorney: 0.15,
  client: 0.10,
  practice_area: 0.15,
  case_type: 0.10,
  jurisdiction: 0.10,
  judge: 0.10,
  topic: 0.15,
};

/**
 * Extract matchable metadata from a case, keyed by dimension.
 * Returns an array of {dimension, value} pairs.
 */
function extractCaseDimensions(caseData: CaseWithResult): { dimension: string; value: string }[] {
  const dims: { dimension: string; value: string }[] = [];

  // Direct metadata mappings
  if (caseData.entity) dims.push({ dimension: 'firm', value: caseData.entity.trim() });
  if (caseData.nature_of_suit) dims.push({ dimension: 'practice_area', value: caseData.nature_of_suit.trim() });
  if (caseData.cause_of_action) dims.push({ dimension: 'practice_area', value: caseData.cause_of_action.trim() });
  if (caseData.case_type) dims.push({ dimension: 'case_type', value: caseData.case_type.trim() });
  if (caseData.court_name) dims.push({ dimension: 'jurisdiction', value: caseData.court_name.trim() });
  if (caseData.judge) dims.push({ dimension: 'judge', value: caseData.judge.trim() });

  // Extract attorney/client names from JSON arrays
  const attorneys = caseData.attorneys as any;
  if (Array.isArray(attorneys)) {
    for (const a of attorneys) {
      const name = typeof a === 'string' ? a : a?.name;
      if (name) dims.push({ dimension: 'attorney', value: name.trim() });
    }
  }

  const plaintiffs = caseData.plaintiffs as any;
  if (Array.isArray(plaintiffs)) {
    for (const p of plaintiffs) {
      const name = typeof p === 'string' ? p : p?.name;
      if (name) dims.push({ dimension: 'client', value: name.trim() });
    }
  }

  const defendants = caseData.defendants as any;
  if (Array.isArray(defendants)) {
    for (const d of defendants) {
      const name = typeof d === 'string' ? d : d?.name;
      if (name) dims.push({ dimension: 'client', value: name.trim() });
    }
  }

  return dims;
}

/**
 * Compute topic similarity between user's topic preferences and a case's complaint summary.
 * Uses simple keyword overlap — each word in the topic entity that appears in the summary
 * contributes to the match score.
 */
function computeTopicScore(
  topicPreferences: PreferenceProfileEntry[],
  complaintSummary: string | null
): { score: number; matchedTopics: ScoreExplanation[] } {
  if (!complaintSummary || topicPreferences.length === 0) {
    return { score: 0, matchedTopics: [] };
  }

  const summaryLower = complaintSummary.toLowerCase();
  const matchedTopics: ScoreExplanation[] = [];
  let totalScore = 0;

  for (const pref of topicPreferences) {
    const topicWords = pref.entity.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (topicWords.length === 0) continue;

    const matchedWords = topicWords.filter((word) => summaryLower.includes(word));
    const matchRatio = matchedWords.length / topicWords.length;

    // Only count if at least 50% of topic words match
    if (matchRatio >= 0.5) {
      const contribution = pref.avg_score * matchRatio;
      totalScore += contribution;
      matchedTopics.push({
        dimension: 'topic',
        entity: pref.entity,
        avg_score: pref.avg_score,
        weighted_contribution: contribution,
      });
    }
  }

  return { score: totalScore, matchedTopics };
}

/**
 * Score a single case against the user's preference profile.
 * Returns the personalization score and explanations for why.
 */
function scoreCase(
  caseData: CaseWithResult,
  profile: PreferenceProfileEntry[],
  weights: Map<string, number>,
  topicPreferences: PreferenceProfileEntry[]
): { score: number; explanations: ScoreExplanation[] } {
  const caseDimensions = extractCaseDimensions(caseData);
  const explanations: ScoreExplanation[] = [];
  let totalScore = 0;

  // Build a lookup: dimension -> entity -> profile entry
  const profileLookup = new Map<string, Map<string, PreferenceProfileEntry>>();
  for (const entry of profile) {
    if (!profileLookup.has(entry.dimension)) {
      profileLookup.set(entry.dimension, new Map());
    }
    profileLookup.get(entry.dimension)!.set(entry.entity.toLowerCase(), entry);
  }

  // Score entity-based dimensions (everything except topic)
  for (const { dimension, value } of caseDimensions) {
    const dimensionMap = profileLookup.get(dimension);
    if (!dimensionMap) continue;

    const entry = dimensionMap.get(value.toLowerCase());
    if (!entry) continue;

    const dimWeight = weights.get(dimension) ?? DEFAULT_DIMENSION_WEIGHTS[dimension] ?? 0.1;
    const contribution = entry.avg_score * dimWeight;
    totalScore += contribution;

    explanations.push({
      dimension,
      entity: entry.entity,
      avg_score: entry.avg_score,
      weighted_contribution: contribution,
    });
  }

  // Score topic dimension via complaint summary matching
  const topicWeight = weights.get('topic') ?? DEFAULT_DIMENSION_WEIGHTS.topic ?? 0.15;
  const { score: topicScore, matchedTopics } = computeTopicScore(
    topicPreferences,
    caseData.complaint_summary || null
  );

  if (topicScore !== 0) {
    totalScore += topicScore * topicWeight;
    for (const mt of matchedTopics) {
      explanations.push({
        ...mt,
        weighted_contribution: mt.weighted_contribution * topicWeight,
      });
    }
  }

  return { score: totalScore, explanations };
}

/**
 * Rerank cases using the user's preference profile and dimension weights.
 * Blends base relevance (position) with personalization score.
 *
 * @param cases - Cases in their base relevance order (newest first, or vector similarity order)
 * @param profile - User's preference profile entries
 * @param dimensionWeights - User's learned dimension weights
 * @returns Cases re-sorted with personalization scores and explanations
 */
export function rerankWithProfile(
  cases: CaseWithResult[],
  profile: PreferenceProfileEntry[],
  dimensionWeights: DimensionWeight[]
): ScoredCase[] {
  if (cases.length === 0) return [];

  // Build weights map
  const weights = new Map<string, number>();
  for (const dw of dimensionWeights) {
    weights.set(dw.dimension, dw.weight);
  }

  // Separate topic preferences for complaint summary matching
  const topicPreferences = profile.filter((p) => p.dimension === 'topic');
  const hasProfile = profile.length > 0;

  // Score all cases
  const scored: ScoredCase[] = cases.map((c, index) => {
    if (!hasProfile) {
      return { ...c, personalization_score: 0, explanations: [] };
    }

    const { score, explanations } = scoreCase(c, profile, weights, topicPreferences);

    return {
      ...c,
      personalization_score: score,
      explanations: explanations
        .sort((a, b) => Math.abs(b.weighted_contribution) - Math.abs(a.weighted_contribution))
        .slice(0, 3), // Top 3 explanations
    };
  });

  if (!hasProfile) return scored;

  // Compute blending alpha/beta based on profile maturity
  const totalMentions = dimensionWeights.reduce((sum, dw) => sum + dw.total_mentions, 0);
  let alpha = 0.8; // base relevance weight
  let beta = 0.2;  // personalization weight

  if (totalMentions > 10) { alpha = 0.7; beta = 0.3; }
  if (totalMentions > 25) { alpha = 0.6; beta = 0.4; }
  if (totalMentions > 50) { alpha = 0.5; beta = 0.5; }

  // Normalize personalization scores to 0-1 range
  const persScores = scored.map((s) => s.personalization_score ?? 0);
  const maxPers = Math.max(...persScores.map(Math.abs), 0.001);

  const blended = scored.map((c, index) => {
    const baseScore = (cases.length - index) / cases.length; // position-based
    const normalizedPers = (c.personalization_score ?? 0) / maxPers;
    const finalScore = (baseScore * alpha) + (normalizedPers * beta);

    return { ...c, relevance_score: finalScore };
  });

  return blended.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
}

// ============================================
// LEGACY: Keep old exports for backward compat during transition
// These are still used by the old user_preferences system
// and can be removed once Phase 2 is fully deployed
// ============================================

export interface UserPreferenceLegacy {
  id: number;
  user_id: string;
  feature_key: string;
  feature_value: string;
  weight: number;
}

const LEGACY_FEATURE_KEYS = ['nature_of_suit', 'cause_of_action', 'entity', 'source', 'court_name', 'judge'] as const;

export function extractCaseFeatures(caseData: CaseWithResult): { key: string; value: string }[] {
  const features: { key: string; value: string }[] = [];
  for (const key of LEGACY_FEATURE_KEYS) {
    const value = caseData[key as keyof CaseWithResult];
    if (typeof value === 'string' && value.trim()) {
      features.push({ key, value: value.trim() });
    }
  }
  return features;
}

export function rerankCases(
  cases: CaseWithResult[],
  preferences: UserPreferenceLegacy[]
): CaseWithResult[] {
  // Legacy passthrough — just return cases as-is if called
  return cases;
}
