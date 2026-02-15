'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import CaseCard from '@/components/CaseCard';
import FilterPanel, { FilterState, defaultFilters } from '@/components/FilterPanel';
import { CaseWithResult, UserPreference } from '@/lib/types';
import { rerankCases } from '@/lib/personalization';
import { LayoutDashboard, Loader2, AlertCircle, Search } from 'lucide-react';
import Link from 'next/link';

const SENTINEL_VALUES = ['No complaint found', 'ERROR', 'Failed to fetch pleadings.', ''];

export default function DashboardPage() {
  const [cases, setCases] = useState<CaseWithResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [availableNatures, setAvailableNatures] = useState<string[]>([]);
  const [availableConsultants, setAvailableConsultants] = useState<string[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const router = useRouter();
  const supabase = createClient();

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
        .select('*, consultant_results(*)')
        .not('complaint_summary', 'is', null)
        .neq('complaint_summary', '')
        .neq('complaint_summary', 'No complaint found')
        .neq('complaint_summary', 'ERROR')
        .neq('complaint_summary', 'Failed to fetch pleadings.')
        .order('filed', { ascending: false })
        .limit(100);

      // Apply filters
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

      // Fetch user reactions
      const { data: reactions } = await supabase
        .from('user_reactions')
        .select('*')
        .eq('user_id', session.user.id);

      const reactionsMap = new Map(
        (reactions || []).map((r: any) => [r.case_id, r])
      );

      // Fetch user favorites
      const { data: favorites } = await supabase
        .from('user_favorites')
        .select('case_id')
        .eq('user_id', session.user.id);

      const favoritesSet = new Set(
        (favorites || []).map((f: any) => f.case_id)
      );

      // Merge and filter
      let merged: CaseWithResult[] = (casesData || []).map((c: any) => ({
        ...c,
        consultant_results: c.consultant_results?.[0] || null,
        user_reaction: reactionsMap.get(c.id) || null,
        user_favorite: favoritesSet.has(c.id),
      }));

      // Client-side filters
      if (filters.viability.length > 0) {
        merged = merged.filter(
          (c) => c.consultant_results?.case_viability && filters.viability.includes(c.consultant_results.case_viability)
        );
      }
      if (filters.minScore) {
        merged = merged.filter(
          (c) => c.consultant_results?.score_1 && c.consultant_results.score_1 >= (filters.minScore || 0)
        );
      }
      if (filters.consultant.length > 0) {
        merged = merged.filter((c) => {
          const r = c.consultant_results;
          if (!r) return false;
          return filters.consultant.some(
            (name) => r.person_1 === name || r.person_2 === name || r.person_3 === name
          );
        });
      }
      if (filters.favoritesOnly) {
        merged = merged.filter((c) => c.user_favorite);
      }

      // Fetch user preferences and rerank
      const { data: preferences } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', session.user.id);

      if (preferences && preferences.length > 0) {
        merged = rerankCases(merged, preferences as UserPreference[]);
      }

      setCases(merged);

      // Check API key status
      const { data: settings } = await supabase
        .from('user_settings')
        .select('api_key_encrypted')
        .eq('user_id', session.user.id)
        .single();
      setHasApiKey(!!settings?.api_key_encrypted);

    } catch (err: any) {
      setError(err.message || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, [filters, router, supabase]);

  // Fetch filter options on mount
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

      // Get unique consultant names from results
      const { data: results } = await supabase
        .from('consultant_results')
        .select('person_1, person_2, person_3');

      const consultantNames = new Set<string>();
      (results || []).forEach((r: any) => {
        if (r.person_1) consultantNames.add(r.person_1);
        if (r.person_2) consultantNames.add(r.person_2);
        if (r.person_3) consultantNames.add(r.person_3);
      });
      setAvailableConsultants([...consultantNames].sort());
    }

    fetchFilterOptions();
  }, [supabase]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  return (
    <AppShell>
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
          <Link href="/search" className="btn-primary gap-2 self-start">
            <Search className="w-4 h-4" />
            Search Cases
          </Link>
        </div>

        {/* API Key Banner */}
        {hasApiKey === false && (
          <div className="card p-4 mb-6 border-amber-200 bg-amber-50/50 animate-slide-down">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Add your Gemini API key to enable AI-powered search
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Go to{' '}
                  <Link href="/settings" className="underline hover:text-amber-800">
                    Settings
                  </Link>{' '}
                  to configure your API key and model preference.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Filters */}
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            availableNatures={availableNatures}
            availableConsultants={availableConsultants}
          />

          {/* Cases Grid */}
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
                {cases.map((c, i) => (
                  <div
                    key={c.id}
                    className="animate-slide-up"
                    style={{ animationDelay: `${Math.min(i * 40, 400)}ms`, animationFillMode: 'both' }}
                  >
                    <CaseCard caseData={c} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
