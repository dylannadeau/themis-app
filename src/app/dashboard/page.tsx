'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import CaseCard from '@/components/CaseCard';
import FilterPanel, { FilterState, defaultFilters } from '@/components/FilterPanel';
import InteractionTabs, { InteractionTab } from '@/components/InteractionTabs';
import ScoreCasesModal, { ScoringOptions, CaseStats } from '@/components/ScoreCasesModal';
import { CaseWithResult } from '@/lib/types';
import { rerankWithProfile, ScoredCase, PreferenceProfileEntry, DimensionWeight } from '@/lib/personalization';
import NewUserSetupModal from '@/components/NewUserSetupModal';
import { useToast, ToastContainer } from '@/components/Toast';
import { LayoutDashboard, Loader2, AlertCircle, Search, RefreshCw, Sparkles, X } from 'lucide-react';
import Link from 'next/link';

interface ScoreData {
  case_id: string;
  score: number;
  reasoning: string | null;
  source: string;
  stale: boolean;
}

const PAGE_SIZE = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default function DashboardPage() {
  const [allCases, setAllCases] = useState<ScoredCase[]>([]);
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
  const [showRefreshBanner, setShowRefreshBanner] = useState(false);
  const [activeTab, setActiveTab] = useState<InteractionTab>('new');
  const [removingCaseIds, setRemovingCaseIds] = useState<Set<string>>(new Set());
  const [showScoringModal, setShowScoringModal] = useState(false);
  const [scoringProgress, setScoringProgress] = useState<{
    active: boolean;
    completed: number;
    total: number;
  } | null>(null);
  const scoringCancelledRef = useRef(false);

  // Pagination state
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Refs for user data (available to loadMore without refetch)
  const reactionsMapRef = useRef<Map<string, any>>(new Map());
  const favoritesSetRef = useRef<Set<string>>(new Set());
  const profileRef = useRef<PreferenceProfileEntry[]>([]);
  const weightsRef = useRef<DimensionWeight[]>([]);
  const bioTextRef = useRef<string | null>(null);

  // Interaction sets — refs for mutation without re-render, state mirror for counts
  const likedIdsRef = useRef<Set<string>>(new Set());
  const dislikedIdsRef = useRef<Set<string>>(new Set());
  const reviewedIdsRef = useRef<Set<string>>(new Set());
  const interactedIdsRef = useRef<Set<string>>(new Set());
  const [counts, setCounts] = useState({ new: 0, liked: 0, disliked: 0, reviewed: 0, all: 0 });

  const { toasts, showToast } = useToast();
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

  const recalcCounts = useCallback((allCasesArr: ScoredCase[]) => {
    setCounts({
      new: allCasesArr.filter((c) => !interactedIdsRef.current.has(c.id)).length,
      liked: allCasesArr.filter((c) => likedIdsRef.current.has(c.id)).length,
      disliked: allCasesArr.filter((c) => dislikedIdsRef.current.has(c.id)).length,
      reviewed: allCasesArr.filter((c) => reviewedIdsRef.current.has(c.id)).length,
      all: allCasesArr.length,
    });
  }, []);

  const filterByTab = useCallback((allCasesArr: ScoredCase[], tab: InteractionTab): ScoredCase[] => {
    switch (tab) {
      case 'new': return allCasesArr.filter((c) => !interactedIdsRef.current.has(c.id));
      case 'liked': return allCasesArr.filter((c) => likedIdsRef.current.has(c.id));
      case 'disliked': return allCasesArr.filter((c) => dislikedIdsRef.current.has(c.id));
      case 'reviewed': return allCasesArr.filter((c) => reviewedIdsRef.current.has(c.id));
      case 'all': return allCasesArr;
    }
  }, []);

  // Sort cases: scored cases first (by score desc), then unscored by filed date desc
  const sortCases = useCallback((casesArr: ScoredCase[], scores: Map<string, ScoreData>): ScoredCase[] => {
    return [...casesArr].sort((a, b) => {
      const scoreA = scores.get(a.id);
      const scoreB = scores.get(b.id);
      // Both scored: sort by score desc
      if (scoreA && scoreB) return scoreB.score - scoreA.score;
      // Only one scored: scored first
      if (scoreA && !scoreB) return -1;
      if (!scoreA && scoreB) return 1;
      // Neither scored: sort by filed date desc
      const dateA = a.filed ? new Date(a.filed).getTime() : 0;
      const dateB = b.filed ? new Date(b.filed).getTime() : 0;
      return dateB - dateA;
    });
  }, []);

  // Helper to build a base cases query with current filters applied
  const buildCasesQuery = useCallback((selectClause: string, opts?: { count?: 'exact'; head?: boolean }) => {
    let query = supabase
      .from('cases')
      .select(selectClause, opts as any)
      .not('complaint_summary', 'is', null)
      .neq('complaint_summary', '')
      .neq('complaint_summary', 'No complaint found')
      .neq('complaint_summary', 'ERROR')
      .neq('complaint_summary', 'Failed to fetch pleadings.');

    if (filters.dateRange.from) query = query.gte('filed', filters.dateRange.from);
    if (filters.dateRange.to) query = query.lte('filed', filters.dateRange.to);
    if (filters.sourceSearch.trim()) query = query.ilike('source', `%${filters.sourceSearch.trim()}%`);
    if (filters.natureOfSuit.length > 0) query = query.in('nature_of_suit', filters.natureOfSuit);

    return query;
  }, [supabase, filters]);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPage(0);
    setHasMore(true);
    setTotalCount(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/auth');
        return;
      }

      // Fetch count, first page, and all user data in parallel
      const [countResult, casesResult, reactionsResult, favoritesResult, narrativesResult, profileResult, weightsResult, settingsResult, scoresResult] = await Promise.all([
        buildCasesQuery('id', { count: 'exact', head: true }),
        buildCasesQuery('*')
          .order('filed', { ascending: false })
          .range(0, PAGE_SIZE - 1),
        supabase
          .from('user_reactions')
          .select('*')
          .eq('user_id', session.user.id),
        supabase
          .from('user_favorites')
          .select('case_id')
          .eq('user_id', session.user.id),
        supabase
          .from('user_narratives')
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
        fetchScores(session.user.id),
      ]);

      if (casesResult.error) throw casesResult.error;

      const total = countResult.count ?? 0;
      setTotalCount(total);

      const casesData = casesResult.data || [];

      // Store user data in refs for loadMore
      const reactions = reactionsResult.data || [];
      const reactionsMap = new Map(reactions.map((r: any) => [r.case_id, r]));
      const favoritesSet = new Set((favoritesResult.data || []).map((f: any) => f.case_id));

      reactionsMapRef.current = reactionsMap;
      favoritesSetRef.current = favoritesSet;
      profileRef.current = (profileResult.data || []) as PreferenceProfileEntry[];
      weightsRef.current = (weightsResult.data || []) as DimensionWeight[];
      bioTextRef.current = settingsResult.data?.bio_text || null;

      // Build interaction sets
      const liked = new Set(reactions.filter((r: any) => r.reaction === 1).map((r: any) => r.case_id as string));
      const disliked = new Set(reactions.filter((r: any) => r.reaction === -1).map((r: any) => r.case_id as string));
      const reviewed = new Set((narrativesResult.data || []).map((n: any) => n.case_id as string));
      const interacted = new Set([...liked, ...disliked, ...reviewed]);

      likedIdsRef.current = liked;
      dislikedIdsRef.current = disliked;
      reviewedIdsRef.current = reviewed;
      interactedIdsRef.current = interacted;

      // Merge cases with reactions and favorites
      let merged: CaseWithResult[] = casesData.map((c: any) => ({
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

      if (!userHasApiKey && !userHasBio && !setupDismissed) {
        setShowSetupModal(true);
      }

      // Rerank using profile + bio
      const reranked = rerankWithProfile(
        merged,
        profileRef.current,
        weightsRef.current,
        bioText
      );

      // Sort initial batch: scores first, then filed date
      const sorted = sortCases(reranked, scoresResult);

      setAllCases(sorted);
      setShowRefreshBanner(false);
      setHasMore(casesData.length >= PAGE_SIZE);

    } catch (err: any) {
      setError(err.message || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, [filters, router, supabase, setupDismissed, fetchScores, sortCases, buildCasesQuery]);

  const loadMoreCases = useCallback(async () => {
    if (!hasMore || isLoadingMore || loading) return;

    setIsLoadingMore(true);
    const nextPage = page + 1;
    const from = nextPage * PAGE_SIZE;

    try {
      const { data: casesData, error: casesError } = await buildCasesQuery('*')
        .order('filed', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (casesError) throw casesError;

      const batch = casesData || [];

      if (batch.length === 0) {
        setHasMore(false);
        return;
      }

      // Merge with user data from refs
      let merged: CaseWithResult[] = batch.map((c: any) => ({
        ...c,
        user_reaction: reactionsMapRef.current.get(c.id) || null,
        user_favorite: favoritesSetRef.current.has(c.id),
      }));

      if (filters.favoritesOnly) {
        merged = merged.filter((c) => c.user_favorite);
      }

      // Rerank new batch using stored profile data
      const reranked = rerankWithProfile(
        merged,
        profileRef.current,
        weightsRef.current,
        bioTextRef.current
      );

      // Append to existing cases (no global re-sort — preserves browse position)
      setAllCases(prev => [...prev, ...reranked]);
      setPage(nextPage);
      setHasMore(batch.length >= PAGE_SIZE);

    } catch (err: any) {
      console.error('Failed to load more cases:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, loading, page, filters.favoritesOnly, buildCasesQuery]);

  // Callback ref for scroll sentinel — fires when the sentinel div mounts/unmounts,
  // avoiding the timing issue where useEffect-based observers miss the initial mount.
  const loadMoreRef = useRef(loadMoreCases);
  loadMoreRef.current = loadMoreCases;

  const setSentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (node) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            loadMoreRef.current();
          }
        },
        { rootMargin: '0px 0px 200px 0px' }
      );
      observerRef.current.observe(node);
    }
  }, []);

  // Re-filter when tab or loaded cases change
  useEffect(() => {
    setCases(filterByTab(allCases, activeTab));
    recalcCounts(allCases);
  }, [activeTab, allCases, filterByTab, recalcCounts]);

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

  // --- Background scoring ---
  const matchesKeyword = (c: ScoredCase, kw: string): boolean => {
    const lower = kw.toLowerCase();
    const name = (c.case_name || '').toLowerCase();
    const summary = (c.complaint_summary || '').toLowerCase();
    return name.includes(lower) || summary.includes(lower);
  };

  const runBackgroundScoring = useCallback(async (options: ScoringOptions) => {
    scoringCancelledRef.current = false;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // Filter target cases based on options
    const isStaleOnly = options.viability.length === 3 && options.includeAlreadyScored &&
      !options.dateRange?.from && !options.dateRange?.to && !options.keyword;

    const targetCases = allCases.filter((c) => {
      const caseViability = (c as any).case_viability || null;

      // Viability filter
      if (caseViability && !options.viability.includes(caseViability)) return false;
      // If case has no viability data, include it only if all viability levels selected
      if (!caseViability && options.viability.length < 3) return false;

      // Date range
      if (options.dateRange?.from && c.filed && c.filed < options.dateRange.from) return false;
      if (options.dateRange?.to && c.filed && c.filed > options.dateRange.to) return false;

      // Keyword
      if (options.keyword && !matchesKeyword(c, options.keyword)) return false;

      // Scored/unscored
      const score = scoresMap.get(c.id);
      if (isStaleOnly) {
        // Stale only mode: only cases with stale scores
        return score?.stale === true;
      }
      if (!options.includeAlreadyScored) {
        if (score && !score.stale) return false;
      }

      return true;
    });

    if (targetCases.length === 0) {
      showToast('No cases match the selected filters');
      return;
    }

    const batches = chunk(targetCases.map((c) => c.id), 10);
    setScoringProgress({ active: true, completed: 0, total: targetCases.length });

    let totalCompleted = 0;

    try {
      for (const batch of batches) {
        if (scoringCancelledRef.current) break;

        const response = await fetch('/api/score-cases', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ case_ids: batch }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          showToast(errData.error || 'Scoring batch failed');
          continue;
        }

        const result = await response.json();

        // Merge new scores into scoresMap
        if (result.scores) {
          setScoresMap((prev) => {
            const next = new Map(prev);
            for (const s of result.scores) {
              next.set(s.case_id, {
                case_id: s.case_id,
                score: s.score,
                reasoning: s.reasoning,
                source: 'direct',
                stale: false,
              });
            }
            return next;
          });
        }

        totalCompleted += batch.length;
        setScoringProgress({ active: true, completed: totalCompleted, total: targetCases.length });
      }

      if (!scoringCancelledRef.current) {
        showToast(`Scored ${totalCompleted} cases`);
      }
    } catch (err: any) {
      showToast(err.message || 'Scoring failed');
    } finally {
      setScoringProgress(null);
    }
  }, [allCases, scoresMap, supabase, showToast]);

  const handleStartScoring = (options: ScoringOptions) => {
    setShowScoringModal(false);
    runBackgroundScoring(options);
  };

  const handleCancelScoring = () => {
    scoringCancelledRef.current = true;
    setScoringProgress(null);
    showToast('Scoring cancelled');
  };

  const handleCardInteraction = useCallback((caseId: string, type: 'liked' | 'disliked' | 'reviewed') => {
    if (type === 'liked') likedIdsRef.current.add(caseId);
    if (type === 'disliked') dislikedIdsRef.current.add(caseId);
    if (type === 'reviewed') reviewedIdsRef.current.add(caseId);
    interactedIdsRef.current.add(caseId);

    setShowRefreshBanner(true);
    recalcCounts(allCases);

    if (activeTab === 'new') {
      setRemovingCaseIds((prev) => new Set([...prev, caseId]));
      setTimeout(() => {
        setCases((prev) => prev.filter((c) => c.id !== caseId));
        setRemovingCaseIds((prev) => {
          const next = new Set(prev);
          next.delete(caseId);
          return next;
        });
      }, 300);
      showToast(`Moved to ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    }
  }, [activeTab, allCases, recalcCounts, showToast]);

  // Compute case stats for modal
  const caseStats: CaseStats = useMemo(() => {
    let high = 0, medium = 0, low = 0;
    for (const c of allCases) {
      const viability = (c as any).case_viability;
      if (viability === 'high') high++;
      else if (viability === 'medium') medium++;
      else if (viability === 'low') low++;
    }
    let alreadyScored = 0;
    let stale = 0;
    for (const c of allCases) {
      const s = scoresMap.get(c.id);
      if (s) {
        if (s.stale) stale++;
        else alreadyScored++;
      }
    }
    return {
      total: allCases.length,
      highViability: high,
      mediumViability: medium,
      lowViability: low,
      alreadyScored,
      stale,
    };
  }, [allCases, scoresMap]);

  const progressPercent = scoringProgress
    ? Math.round((scoringProgress.completed / Math.max(1, scoringProgress.total)) * 100)
    : 0;

  return (
    <AppShell>
      {showSetupModal && (
        <NewUserSetupModal onComplete={handleSetupComplete} />
      )}
      <ScoreCasesModal
        isOpen={showScoringModal}
        onClose={() => setShowScoringModal(false)}
        onStartScoring={handleStartScoring}
        caseStats={caseStats}
      />
      <ToastContainer toasts={toasts} />
      <div className="page-container">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="section-title flex items-center gap-3">
              <LayoutDashboard className="w-6 h-6 text-themis-500" />
              Dashboard
            </h1>
            {!loading && (
              <p className="text-sm text-gray-500 mt-1">
                Showing {cases.length}{totalCount !== null && totalCount !== cases.length ? ` of ${totalCount}` : ''} cases
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 self-start">
            <button
              onClick={() => setShowScoringModal(true)}
              disabled={loading || !!scoringProgress}
              className="btn-primary gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Score Cases
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

        {/* Scoring Progress Bar */}
        {scoringProgress && (
          <div className="mb-6 animate-slide-down">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm text-themis-700 font-medium">
                Scoring cases... {scoringProgress.completed} of {scoringProgress.total} complete
              </p>
              <button
                onClick={handleCancelScoring}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 transition-colors"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            </div>
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-themis-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Interaction Tabs */}
        <div className="mb-6">
          <InteractionTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            counts={counts}
          />
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
                <p className="text-gray-500">
                  {activeTab === 'new'
                    ? 'No new cases to review. Check the other tabs or adjust your filters.'
                    : activeTab === 'all'
                      ? 'No cases match your current filters.'
                      : `No ${activeTab} cases yet.`}
                </p>
                {activeTab !== 'all' && (
                  <button
                    onClick={() => setActiveTab('all')}
                    className="btn-secondary mt-4 text-sm"
                  >
                    View All Cases
                  </button>
                )}
                {activeTab === 'all' && (
                  <button
                    onClick={() => setFilters(defaultFilters)}
                    className="btn-secondary mt-4 text-sm"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {cases.map((c, i) => {
                  const scoreData = scoresMap.get(c.id);
                  const isRemoving = removingCaseIds.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={
                        isRemoving
                          ? 'opacity-0 -translate-y-2 scale-[0.98] transition-all duration-300'
                          : 'animate-slide-up'
                      }
                      style={isRemoving ? undefined : { animationDelay: `${Math.min(i * 40, 400)}ms`, animationFillMode: 'both' }}
                    >
                      <CaseCard
                        caseData={c}
                        onReactionChange={() => setShowRefreshBanner(true)}
                        onInteraction={handleCardInteraction}
                        score={scoreData?.score ?? null}
                        scoreReasoning={scoreData?.reasoning ?? null}
                        scoreSource={scoreData?.source ?? null}
                        scoreStale={scoreData?.stale ?? false}
                        caseViability={(c as any).case_viability ?? null}
                        viabilityReasoning={(c as any).viability_reasoning ?? null}
                      />
                    </div>
                  );
                })}

                {/* Scroll sentinel for infinite scroll */}
                <div ref={setSentinelRef} className="h-1" />

                {/* Loading spinner while fetching more */}
                {isLoadingMore && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 text-themis-500 animate-spin" />
                  </div>
                )}

                {/* End of list indicator */}
                {!hasMore && !isLoadingMore && (
                  <p className="text-center text-sm text-gray-400 py-6">No more cases</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
