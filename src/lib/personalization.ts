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

/** Minimum narratives before feedback-based scoring kicks in */
const COLD_START_THRESHOLD = 3;

/**
 * Extract matchable metadata from a case, keyed by dimension.
 */
function extractCaseDimensions(caseData: CaseWithResult): { dimension: string; value: string }[] {
  const dims: { dimension: string; value: string }[] = [];

  if (caseData.entity) dims.push({ dimension: 'firm', value: caseData.entity.trim() });
  if (caseData.nature_of_suit) dims.push({ dimension: 'practice_area', value: caseData.nature_of_suit.trim() });
  if (caseData.cause_of_action) dims.push({ dimension: 'practice_area', value: caseData.cause_of_action.trim() });
  if (caseData.case_type) dims.push({ dimension: 'case_type', value: caseData.case_type.trim() });
  if (caseData.court_name) dims.push({ dimension: 'jurisdiction', value: caseData.court_name.trim() });
  if (caseData.judge) dims.push({ dimension: 'judge', value: caseData.judge.trim() });

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
 * Compute topic similarity between topic preferences and a case's complaint summary.
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
 * Compute bio relevance score for a case.
 * Tokenizes the bio and the case's complaint summary + metadata,
 * then scores based on keyword overlap.
 *
 * Returns a 0-1 score and an explanation if relevant.
 */
function computeBioScore(
  bioText: string | null,
  caseData: CaseWithResult
): { score: number; explanation: ScoreExplanation | null } {
  if (!bioText || !bioText.trim()) {
    return { score: 0, explanation: null };
  }

  // Build case text from summary + metadata
  const caseTextParts: string[] = [];
  if (caseData.complaint_summary) caseTextParts.push(caseData.complaint_summary);
  if (caseData.nature_of_suit) caseTextParts.push(caseData.nature_of_suit);
  if (caseData.cause_of_action) caseTextParts.push(caseData.cause_of_action);
  if (caseData.case_type) caseTextParts.push(caseData.case_type);
  if (caseData.court_name) caseTextParts.push(caseData.court_name);

  const caseText = caseTextParts.join(' ').toLowerCase();
  if (!caseText) return { score: 0, explanation: null };

  // Tokenize bio into meaningful words (skip common stop words, keep 3+ char words)
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
    'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from', 'with',
    'they', 'this', 'that', 'will', 'each', 'make', 'like', 'long', 'look',
    'many', 'some', 'them', 'than', 'been', 'would', 'about', 'their', 'which',
    'could', 'other', 'into', 'more', 'also', 'over', 'such', 'after', 'most',
    'work', 'worked', 'working', 'including', 'experience', 'years', 'year',
  ]);

  const bioWords = bioText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Deduplicate
  const uniqueBioWords = [...new Set(bioWords)];
  if (uniqueBioWords.length === 0) return { score: 0, explanation: null };

  // Count matches
  const matchedWords = uniqueBioWords.filter((word) => caseText.includes(word));
  const matchRatio = matchedWords.length / uniqueBioWords.length;

  // Only consider it a meaningful match if enough words overlap
  if (matchRatio < 0.05 || matchedWords.length < 2) {
    return { score: 0, explanation: null };
  }

  // Score scales with match ratio but caps at 1.0
  const score = Math.min(1.0, matchRatio * 3);

  // Build a short explanation from the top matched terms
  const topMatches = matchedWords.slice(0, 4).join(', ');

  return {
    score,
    explanation: {
      dimension: 'bio',
      entity: topMatches,
      avg_score: score,
      weighted_contribution: score,
    },
  };
}

/**
 * Score a single case against the user's preference profile.
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

  const profileLookup = new Map<string, Map<string, PreferenceProfileEntry>>();
  for (const entry of profile) {
    if (!profileLookup.has(entry.dimension)) {
      profileLookup.set(entry.dimension, new Map());
    }
    profileLookup.get(entry.dimension)!.set(entry.entity.toLowerCase(), entry);
  }

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
 * Rerank cases using the user's preference profile, dimension weights, and bio.
 *
 * Scoring strategy:
 * - If no bio and no profile: return cases in base order (no personalization)
 * - If bio but < 3 narratives: lean heavily on bio similarity
 * - If >= 3 narratives: blend bio + feedback, with feedback growing in weight over time
 */
export function rerankWithProfile(
  cases: CaseWithResult[],
  profile: PreferenceProfileEntry[],
  dimensionWeights: DimensionWeight[],
  bioText?: string | null
): ScoredCase[] {
  if (cases.length === 0) return [];

  const hasBio = !!bioText && bioText.trim().length > 0;
  const hasProfile = profile.length > 0;

  // No personalization data at all — return as-is
  if (!hasBio && !hasProfile) {
    return cases.map((c) => ({ ...c, personalization_score: 0, explanations: [] }));
  }

  const weights = new Map<string, number>();
  for (const dw of dimensionWeights) {
    weights.set(dw.dimension, dw.weight);
  }

  const topicPreferences = profile.filter((p) => p.dimension === 'topic');
  const totalNarratives = dimensionWeights.reduce((sum, dw) => sum + dw.total_mentions, 0);
  const feedbackMature = totalNarratives >= COLD_START_THRESHOLD;

  // Score all cases
  const scored: ScoredCase[] = cases.map((c, index) => {
    let feedbackScore = 0;
    let feedbackExplanations: ScoreExplanation[] = [];
    let bioScore = 0;
    let bioExplanation: ScoreExplanation | null = null;

    // Feedback-based scoring
    if (hasProfile) {
      const result = scoreCase(c, profile, weights, topicPreferences);
      feedbackScore = result.score;
      feedbackExplanations = result.explanations;
    }

    // Bio-based scoring
    if (hasBio) {
      const result = computeBioScore(bioText!, c);
      bioScore = result.score;
      bioExplanation = result.explanation;
    }

    // Blend bio and feedback based on maturity
    let personalScore: number;
    const allExplanations: ScoreExplanation[] = [...feedbackExplanations];

    if (!feedbackMature) {
      // Cold start: bio dominates, feedback is minor
      const bioWeight = hasProfile ? 0.7 : 1.0;
      const fbWeight = hasProfile ? 0.3 : 0.0;
      personalScore = (bioScore * bioWeight) + (feedbackScore * fbWeight);

      if (bioExplanation && bioScore > 0) {
        bioExplanation.weighted_contribution *= bioWeight;
        allExplanations.push(bioExplanation);
      }
    } else {
      // Mature: feedback dominates, bio provides a floor
      // Feedback weight grows with more narratives
      const fbWeight = Math.min(0.8, 0.5 + (totalNarratives - COLD_START_THRESHOLD) * 0.03);
      const bioWeight = 1.0 - fbWeight;
      personalScore = (bioScore * bioWeight) + (feedbackScore * fbWeight);

      if (bioExplanation && bioScore > 0) {
        bioExplanation.weighted_contribution *= bioWeight;
        allExplanations.push(bioExplanation);
      }
    }

    return {
      ...c,
      personalization_score: personalScore,
      explanations: allExplanations
        .sort((a, b) => Math.abs(b.weighted_contribution) - Math.abs(a.weighted_contribution))
        .slice(0, 3),
    };
  });

  // Compute blending of base relevance (position) + personalization
  const hasAnyPersonalization = scored.some((s) => (s.personalization_score ?? 0) !== 0);
  if (!hasAnyPersonalization) return scored;

  // Determine alpha/beta (base vs personal)
  let alpha = 0.7;
  let beta = 0.3;

  if (feedbackMature) {
    if (totalNarratives > 10) { alpha = 0.5; beta = 0.5; }
    if (totalNarratives > 25) { alpha = 0.4; beta = 0.6; }
    if (totalNarratives > 50) { alpha = 0.3; beta = 0.7; }
  }

  const persScores = scored.map((s) => s.personalization_score ?? 0);
  const maxPers = Math.max(...persScores.map(Math.abs), 0.001);

  const blended = scored.map((c, index) => {
    const baseScore = (cases.length - index) / cases.length;
    const normalizedPers = (c.personalization_score ?? 0) / maxPers;
    const finalScore = (baseScore * alpha) + (normalizedPers * beta);

    return { ...c, relevance_score: finalScore };
  });

  return blended.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
}

