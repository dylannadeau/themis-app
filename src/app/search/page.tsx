'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import CaseCard from '@/components/CaseCard';
import { CaseWithResult } from '@/lib/types';
import { Search as SearchIcon, Loader2, Sparkles, AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CaseWithResult[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    inputRef.current?.focus();

    // Check API key
    async function checkKey() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/auth'); return; }
      const { data } = await supabase
        .from('user_settings')
        .select('api_key_encrypted')
        .eq('user_id', session.user.id)
        .single();
      setHasApiKey(!!data?.api_key_encrypted);
    }
    checkKey();
  }, [supabase, router]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setSynthesis(null);
    setResults([]);
    setSearched(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/auth'); return; }

      // Call search API
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Search failed');
      }

      const data = await response.json();
      setResults(data.cases || []);
      setSynthesis(data.synthesis || null);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="page-container max-w-5xl">
        {/* Search Header */}
        <div className="mb-8">
          <h1 className="section-title flex items-center gap-3 mb-6">
            <SearchIcon className="w-6 h-6 text-themis-500" />
            Search Cases
          </h1>

          <form onSubmit={handleSearch} className="relative">
            <div className="relative">
              <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for cases by topic, statute, party, or any criteria..."
                className="w-full pl-12 pr-32 py-4 rounded-xl border border-gray-200 bg-white text-themis-950 text-base
                           placeholder:text-gray-400
                           focus:outline-none focus:ring-2 focus:ring-themis-500/20 focus:border-themis-400
                           shadow-sm hover:shadow-md transition-all duration-200"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary gap-2 py-2.5"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Search
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Hint text */}
          {!searched && (
            <p className="text-sm text-gray-400 mt-3 ml-1">
              Try: &ldquo;FCRA violations by consumer reporting agencies&rdquo; or &ldquo;patent infringement in semiconductor industry&rdquo;
            </p>
          )}
        </div>

        {/* API Key Warning */}
        {hasApiKey === false && (
          <div className="card p-4 mb-6 border-amber-200 bg-amber-50/50">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  AI-powered search requires a Gemini API key
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Without it, search uses keyword matching only.{' '}
                  <Link href="/settings" className="underline hover:text-amber-800">
                    Add your key in Settings
                  </Link>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card p-4 mb-6 border-red-200 bg-red-50/50 animate-slide-down">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Synthesis Answer */}
        {synthesis && (
          <div className="card p-5 mb-6 border-themis-200/50 bg-gradient-to-br from-themis-50/30 to-white animate-slide-down">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-themis-500" />
              <span className="text-sm font-semibold text-themis-700">AI Summary</span>
            </div>
            <p className="text-sm text-themis-800 leading-relaxed whitespace-pre-wrap">
              {synthesis}
            </p>
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-themis-500 animate-spin mb-4" />
            <p className="text-sm text-gray-500">Searching across cases...</p>
          </div>
        ) : searched && results.length === 0 && !error ? (
          <div className="card p-12 text-center">
            <p className="text-gray-500">No cases matched your query. Try different keywords or broaden your search.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {results.length > 0 && (
              <p className="text-sm text-gray-500 mb-2">
                {results.length} case{results.length !== 1 ? 's' : ''} found
              </p>
            )}
            {results.map((c, i) => (
              <div
                key={c.id}
                className="animate-slide-up"
                style={{ animationDelay: `${Math.min(i * 50, 500)}ms`, animationFillMode: 'both' }}
              >
                <CaseCard caseData={c} />
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
