'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import CaseCard from '@/components/CaseCard';
import FilterPanel, { FilterState, defaultFilters } from '@/components/FilterPanel';
import { CaseWithResult } from '@/lib/types';
import { rerankWithProfile, ScoredCase, PreferenceProfileEntry, DimensionWeight } from '@/lib/personalization';
import NewUserSetupModal from '@/components/NewUserSetupModal';
import { LayoutDashboard, Loader2, AlertCircle, Search, RefreshCw, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface ScoreData {
  case_id: string;
  score: number;
  reasoning: string | null;
  source: string;
  stale: boolean;
}

export default function DashboardPage() {
  const [cases, setCases] = useState<ScoredCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [availableNatures, setAvailableNatures] = useState<string[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [hasBio, setHasBio] = useState<boolean | null>(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [scoresMap, setScoresMap] = useState<Map<string, ScoreData>>(new Map());
  const [isScoring, setIsScoring] = useState(false);
  const [scoringMessage, setScoringMessage] = useState<string | null>(null);
  const [showRefreshBanner, setShowRefreshBanner] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const fetchScores = useCallback(async (userId: string) => {
    const { data: scores } = await supabase
      .from('user_case_scores')
      .select('case_id, score, reasoning, source, stale')
      .eq('user_id', userId);

    const map = new Map(
      (scores || []).map((s: ScoreData) => [s.case_id, s])
    );
    setScoresMap(map);
    return map;
  }, [supabase]);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/auth');
        return;
      }

      // Build query for cases with valid summaries
      let query = supabase
        .from('cases')
        .select('*')
        .not('complaint_summary', 'is', null)
        .neq('complaint_summary', '')
        .neq('complaint_summary', 'No complaint found')
        .neq('complaint_summary', 'ERROR')
        .neq('complaint_summary', 'Failed to fetch pleadings.')
        .order('filed', { ascending: false })
        .limit(100);

      if (filters.dateRange.from) {
        query = query.gte('filed', filters.dateRange.from);
      }
      if (filters.dateRange.to) {
        query = query.lte('filed', filters.dateRange.to);
      }
      if (filters.sourceSearch.trim()) {
        query = query.ilike('source', `%${filters.sourceSearch.trim()}%`);
      }
      if (filters.natureOfSuit.length > 0) {
        query = query.in('nature_of_suit', filters.natureOfSuit);
      }

      const { data: casesData, error: casesError } = await query;
      if (casesError) throw casesError;

      // Fetch user reactions, favorites, and scores in parallel
      const [reactionsResult, favoritesResult, profileResult, weightsResult, settingsResult] = await Promise.all([
        supabase
          .from('user_reactions')
          .select('*')
          .eq('user_id', session.user.id),
        supabase
          .from('user_favorites')
          .select('case_id')
          .eq('user_id', session.user.id),
        supabase
          .from('user_preference_profile')
          .select('dimension, entity, cumulative_score, mention_count, avg_score')
          .eq('user_id', session.user.id),
        supabase
          .from('user_dimension_weights')
          .select('dimension, total_mentions, weight')
          .eq('user_id', session.user.id),
        supabase
          .from('user_settings')
          .select('api_key_encrypted, bio_text')
          .eq('user_id', session.user.id)
          .single(),
      ]);

      // Fetch scores
      await fetchScores(session.user.id);

      const reactionsMap = new Map(
        (reactionsResult.data || []).map((r: any) => [r.case_id, r])
      );
      const favoritesSet = new Set(
        (favoritesResult.data || []).map((f: any) => f.case_id)
      );

      // Merge
      let merged: CaseWithResult[] = (casesData || []).map((c: any) => ({
        ...c,
        user_reaction: reactionsMap.get(c.id) || null,
        user_favorite: favoritesSet.has(c.id),
      }));

      if (filters.favoritesOnly) {
        merged = merged.filter((c) => c.user_favorite);
      }

      const bioText = settingsResult.data?.bio_text || null;
      const userHasApiKey = !!settingsResult.data?.api_key_encrypted;
      const userHasBio = !!bioText;
      setHasApiKey(userHasApiKey);
      setHasBio(userHasBio);

      // Show setup modal for new users who have neither API key nor bio
      if (!userHasApiKey && !userHasBio && !setupDismissed) {
        setShowSetupModal(true);
      }

      // Rerank using profile + bio
      const reranked = rerankWithProfile(
        merged,
        (profileResult.data || []) as PreferenceProfileEntry[],
        (weightsResult.data || []) as DimensionWeight[],
        bioText
      );

      setCases(reranked);
      setShowRefreshBanner(false);

    } catch (err: any) {
      setError(err.message || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, [filters, router, supabase, setupDismissed, fetchScores]);

  useEffect(() => {
    async function fetchFilterOptions() {
      const { data: natures } = await supabase
        .from('cases')
        .select('nature_of_suit')
        .not('nature_of_suit', 'is', null)
        .not('complaint_summary', 'is', null)
        .neq('complaint_summary', '');

      const uniqueNatures = [...new Set((natures || []).map((n: any) => n.nature_of_suit).filter(Boolean))].sort() as string[];
      setAvailableNatures(uniqueNatures);
    }

    fetchFilterOptions();
  }, [supabase]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const handleSetupComplete = () => {
    setShowSetupModal(false);
    setSetupDismissed(true);
    fetchCases();
  };

  const handleScoreAllCases = async () => {
    setIsScoring(true);
    setScoringMessage('Checking clusters...');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Check if clusters exist
      const clusterResponse = await fetch('/api/admin/cluster-cases', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const clusterStats = await clusterResponse.json();

      if (!clusterStats.clustering_run) {
        setScoringMessage(null);
        setIsScoring(false);
        setError('No clusters found. An admin must run clustering first.');
        return;
      }

      setScoringMessage('Scoring... (this may take a minute)');

      const scoreResponse = await fetch('/api/score-cases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mode: 'cluster' }),
      });

      const result = await scoreResponse.json();

      if (!scoreResponse.ok) {
        setError(result.error || 'Scoring failed');
      } else {
        // Re-fetch scores
        await fetchScores(session.user.id);
      }
    } catch (err: any) {
      setError(err.message || 'Scoring failed');
    } finally {
      setIsScoring(false);
      setScoringMessage(null);
    }
  };

  const handleReactionChange = () => {
    setShowRefreshBanner(true);
  };

  const hasScores = scoresMap.size > 0;

  return (
    <AppShell>
      {showSetupModal && (
        <NewUserSetupModal onComplete={handleSetupComplete} />
      )}
      <div className="page-container">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="section-title flex items-center gap-3">
              <LayoutDashboard className="w-6 h-6 text-themis-500" />
              Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {loading ? 'Loading...' : `${cases.length} cases with valid summaries`}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start">
            <button
              onClick={handleScoreAllCases}
              disabled={isScoring || loading}
              className="btn-primary gap-2"
            >
              {isScoring ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {isScoring
                ? (scoringMessage || 'Scoring...')
                : hasScores
                  ? 'Re-Score All Cases'
                  : 'Score All Cases'}
            </button>
            <button
              onClick={fetchCases}
              disabled={loading}
              className="btn-secondary gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link href="/search" className="btn-primary gap-2">
              <Search className="w-4 h-4" />
              Search Cases
            </Link>
          </div>
        </div>

        {/* Refresh Banner */}
        {showRefreshBanner && (
          <div className="card p-4 mb-6 border-themis-200 bg-themis-50/50 animate-slide-down">
            <div className="flex items-center justify-between">
              <p className="text-sm text-themis-700">
                Your preferences have changed. Refresh to update rankings.
              </p>
              <button
                onClick={fetchCases}
                className="btn-secondary text-sm gap-1.5 ml-4 flex-shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>
          </div>
        )}

        {/* API Key Banner */}
        {hasApiKey === false && (
          <div className="card p-4 mb-6 border-amber-200 bg-amber-50/50 animate-slide-down">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Add your Gemini API key to enable AI-powered search and feedback analysis
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Go to{' '}
                  <Link href="/settings" className="underline hover:text-amber-800">
                    Settings
                  </Link>{' '}
                  to configure your API key and professional bio.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Bio Banner */}
        {hasBio === false && hasApiKey !== false && (
          <div className="card p-4 mb-6 border-themis-200 bg-themis-50/50 animate-slide-down">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-themis-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-themis-800">
                  Add your professional bio to get personalized case rankings
                </p>
                <p className="text-xs text-themis-600 mt-0.5">
                  Your bio helps match you with relevant cases immediately.{' '}
                  <Link href="/settings" className="underline hover:text-themis-800">
                    Add it in Settings
                  </Link>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex flex-col lg:flex-row gap-6">
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            availableNatures={availableNatures}
          />

          <div className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-themis-500 animate-spin" />
              </div>
            ) : error ? (
              <div className="card p-8 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                <p className="text-sm text-red-600">{error}</p>
                <button onClick={fetchCases} className="btn-secondary mt-4 text-sm">
                  Retry
                </button>
              </div>
            ) : cases.length === 0 ? (
              <div className="card p-12 text-center">
                <p className="text-gray-500">No cases match your current filters.</p>
                <button
                  onClick={() => setFilters(defaultFilters)}
                  className="btn-secondary mt-4 text-sm"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {cases.map((c, i) => {
                  const scoreData = scoresMap.get(c.id);
                  return (
                    <div
                      key={c.id}
                      className="animate-slide-up"
                      style={{ animationDelay: `${Math.min(i * 40, 400)}ms`, animationFillMode: 'both' }}
                    >
                      <CaseCard
                        caseData={c}
                        onReactionChange={handleReactionChange}
                        score={scoreData?.score ?? null}
                        scoreReasoning={scoreData?.reasoning ?? null}
                        scoreSource={(scoreData?.source as 'cluster' | 'direct') ?? null}
                        scoreStale={scoreData?.stale ?? false}
                        caseViability={(c as any).case_viability ?? null}
                        viabilityReasoning={(c as any).viability_reasoning ?? null}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
