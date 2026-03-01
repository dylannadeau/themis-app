'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import {
  UserCircle, Loader2, AlertCircle, BarChart3, MessageSquare,
  ThumbsUp, ThumbsDown, Minus, ArrowRight, Sparkles,
  Trash2, ChevronUp, ChevronDown, Check, X,
} from 'lucide-react';
import Link from 'next/link';

interface ProfileEntry {
  dimension: string;
  entity: string;
  cumulative_score: number;
  mention_count: number;
  avg_score: number;
}

interface DimensionWeight {
  dimension: string;
  total_mentions: number;
  weight: number;
}

const DIMENSION_LABELS: Record<string, string> = {
  firm: 'Firm',
  attorney: 'Attorney',
  client: 'Client',
  practice_area: 'Practice Area',
  case_type: 'Case Type',
  jurisdiction: 'Jurisdiction',
  judge: 'Judge',
  topic: 'Topic',
};

const DIMENSION_COLORS: Record<string, string> = {
  firm: 'bg-blue-500',
  attorney: 'bg-indigo-500',
  client: 'bg-violet-500',
  practice_area: 'bg-themis-600',
  case_type: 'bg-cyan-500',
  jurisdiction: 'bg-emerald-500',
  judge: 'bg-amber-500',
  topic: 'bg-rose-500',
};

function SentimentIcon({ score }: { score: number }) {
  if (score > 0.1) return <ThumbsUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (score < -0.1) return <ThumbsDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
}

function ScoreBar({ score }: { score: number }) {
  // score ranges -1 to 1, map to 0-100 for display
  const normalized = ((score + 1) / 2) * 100;
  const isPositive = score > 0.1;
  const isNegative = score < -0.1;

  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="relative w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        {/* Center marker */}
        <div className="absolute left-1/2 top-0 w-px h-full bg-gray-300 z-10" />
        {/* Score fill */}
        {isPositive && (
          <div
            className="absolute top-0 h-full bg-emerald-400 rounded-r-full"
            style={{ left: '50%', width: `${((score) / 1) * 50}%` }}
          />
        )}
        {isNegative && (
          <div
            className="absolute top-0 h-full bg-red-400 rounded-l-full"
            style={{
              right: '50%',
              width: `${(Math.abs(score) / 1) * 50}%`,
            }}
          />
        )}
        {!isPositive && !isNegative && (
          <div
            className="absolute top-0 h-full bg-gray-300"
            style={{ left: '49%', width: '2%' }}
          />
        )}
      </div>
      <span className={`text-xs font-mono w-10 text-right ${
        isPositive ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-gray-500'
      }`}>
        {score > 0 ? '+' : ''}{score.toFixed(2)}
      </span>
    </div>
  );
}

export default function PreferencesPage() {
  const [profile, setProfile] = useState<ProfileEntry[]>([]);
  const [dimensionWeights, setDimensionWeights] = useState<DimensionWeight[]>([]);
  const [narrativeCount, setNarrativeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingScore, setEditingScore] = useState(0);
  const [mutating, setMutating] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const refreshData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/auth'); return; }

    const response = await fetch('/api/preferences', {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    if (!response.ok) throw new Error('Failed to load preferences');
    const data = await response.json();
    setProfile(data.profile);
    setDimensionWeights(data.dimension_weights);
    setNarrativeCount(data.narrative_count);
  }, [supabase, router]);

  useEffect(() => {
    async function loadPreferences() {
      try {
        await refreshData();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadPreferences();
  }, [refreshData]);

  const entityKey = (dim: string, entity: string) => `${dim}::${entity}`;

  const handleDelete = async (entry: ProfileEntry) => {
    if (!window.confirm(`Remove "${entry.entity}" from your ${DIMENSION_LABELS[entry.dimension] || entry.dimension} preferences?`)) return;

    const key = entityKey(entry.dimension, entry.entity);
    setMutating(key);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/preferences', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ dimension: entry.dimension, entity: entry.entity }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMutating(null);
    }
  };

  const handleScoreSave = async (entry: ProfileEntry) => {
    const key = entityKey(entry.dimension, entry.entity);
    const rounded = Math.round(editingScore * 10) / 10;
    if (rounded === Math.round(entry.avg_score * 10) / 10) {
      setEditingKey(null);
      return;
    }

    setMutating(key);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ dimension: entry.dimension, entity: entry.entity, avg_score: rounded }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update score');
      }
      setEditingKey(null);
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMutating(null);
    }
  };

  // Group profile entries by dimension
  const profileByDimension: Record<string, ProfileEntry[]> = {};
  for (const entry of profile) {
    if (!profileByDimension[entry.dimension]) {
      profileByDimension[entry.dimension] = [];
    }
    profileByDimension[entry.dimension].push(entry);
  }

  // Sort each dimension's entries by absolute avg_score descending
  for (const dim of Object.keys(profileByDimension)) {
    profileByDimension[dim].sort((a, b) => Math.abs(b.avg_score) - Math.abs(a.avg_score));
  }

  // Calculate max weight for scaling the weight bars
  const maxWeight = dimensionWeights.length > 0
    ? Math.max(...dimensionWeights.map(w => w.weight))
    : 0;

  const hasProfile = profile.length > 0;
  const hasWeights = dimensionWeights.length > 0;
  const isEmpty = !hasProfile && !hasWeights;

  const coldStartThreshold = 3;
  const isColdStart = narrativeCount < coldStartThreshold;

  // Order dimensions: those with weights first (by weight desc), then the rest
  const weightMap = new Map(dimensionWeights.map(w => [w.dimension, w]));
  const orderedDimensions = Object.keys(DIMENSION_LABELS).sort((a, b) => {
    const wA = weightMap.get(a)?.weight ?? 0;
    const wB = weightMap.get(b)?.weight ?? 0;
    return wB - wA;
  });

  return (
    <AppShell>
      <div className="page-container max-w-3xl">
        <h1 className="section-title flex items-center gap-3 mb-2">
          <UserCircle className="w-6 h-6 text-themis-500" />
          Preference Profile
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          What Themis has learned from your feedback. Click a score to adjust it, or remove entities you no longer want.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-themis-500 animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600 mb-6 animate-slide-down">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && isEmpty && (
          <div className="card p-8 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-themis-50 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7 text-themis-400" />
            </div>
            <h2 className="font-display text-xl text-themis-900 mb-2">
              No preferences yet
            </h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
              Themis builds your preference profile as you provide feedback on cases.
              Start by browsing cases on the dashboard and leaving narrative feedback
              to teach the system what matters to you.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/dashboard" className="btn-primary gap-2">
                <ArrowRight className="w-4 h-4" />
                Go to Dashboard
              </Link>
              <Link href="/settings" className="btn-secondary gap-2">
                Set Up API Key
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && !isEmpty && (
          <div className="space-y-6 animate-fade-in">
            {/* Stats overview */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="card p-4">
                <div className="text-xs font-medium text-gray-500 mb-1">Narratives</div>
                <div className="text-2xl font-display text-themis-900">{narrativeCount}</div>
                {isColdStart && (
                  <div className="text-xs text-amber-600 mt-1">
                    {coldStartThreshold - narrativeCount} more to unlock full personalization
                  </div>
                )}
              </div>
              <div className="card p-4">
                <div className="text-xs font-medium text-gray-500 mb-1">Entities Tracked</div>
                <div className="text-2xl font-display text-themis-900">{profile.length}</div>
              </div>
              <div className="card p-4 col-span-2 sm:col-span-1">
                <div className="text-xs font-medium text-gray-500 mb-1">Active Dimensions</div>
                <div className="text-2xl font-display text-themis-900">
                  {Object.keys(profileByDimension).length}
                  <span className="text-sm font-body text-gray-400 ml-1">/ {Object.keys(DIMENSION_LABELS).length}</span>
                </div>
              </div>
            </div>

            {/* Cold start banner */}
            {isColdStart && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-700">
                <MessageSquare className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">Cold start mode.</span>{' '}
                  Your bio is currently weighted at 70% for ranking. After {coldStartThreshold} narratives,
                  your feedback signals will take the lead. You have {narrativeCount} so far.
                </div>
              </div>
            )}

            {/* Dimension Weights */}
            {hasWeights && (
              <div className="card p-6">
                <h2 className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4" />
                  Dimension Weights
                </h2>
                <p className="text-xs text-gray-500 mb-4">
                  How much each dimension influences your personalized rankings, based on your feedback frequency.
                </p>
                <div className="space-y-3">
                  {orderedDimensions.map((dim) => {
                    const w = weightMap.get(dim);
                    const weight = w?.weight ?? 0;
                    const mentions = w?.total_mentions ?? 0;
                    const barWidth = maxWeight > 0 ? (weight / maxWeight) * 100 : 0;
                    const colorClass = DIMENSION_COLORS[dim] || 'bg-gray-400';

                    return (
                      <div key={dim}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-themis-900">
                            {DIMENSION_LABELS[dim] || dim}
                          </span>
                          <span className="text-xs text-gray-500">
                            {mentions > 0 ? `${mentions} mention${mentions !== 1 ? 's' : ''}` : 'No data'}
                            {weight > 0 && (
                              <span className="ml-2 font-mono text-themis-600">
                                {(weight * 100).toFixed(0)}%
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                          {barWidth > 0 ? (
                            <div
                              className={`h-full rounded-full ${colorClass} transition-all duration-500`}
                              style={{ width: `${barWidth}%` }}
                            />
                          ) : (
                            <div className="h-full rounded-full bg-gray-200" style={{ width: '2%' }} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Entity breakdown per dimension */}
            <div className="card p-6">
              <h2 className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4" />
                Learned Preferences
              </h2>
              <p className="text-xs text-gray-500 mb-5">
                Entities extracted from your feedback, grouped by dimension. Positive scores mean you favor this entity; negative means you avoid it.
              </p>

              {Object.keys(profileByDimension).length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No entity preferences extracted yet. Leave narrative feedback on cases to get started.
                </p>
              ) : (
                <div className="space-y-6">
                  {orderedDimensions
                    .filter(dim => profileByDimension[dim]?.length > 0)
                    .map((dim) => {
                      const entries = profileByDimension[dim];
                      const colorClass = DIMENSION_COLORS[dim] || 'bg-gray-400';
                      return (
                        <div key={dim}>
                          <div className="flex items-center gap-2 mb-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${colorClass}`} />
                            <h3 className="text-sm font-semibold text-themis-800">
                              {DIMENSION_LABELS[dim] || dim}
                            </h3>
                            <span className="text-xs text-gray-400">
                              {entries.length} entit{entries.length === 1 ? 'y' : 'ies'}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {entries.map((entry, i) => {
                              const key = entityKey(entry.dimension, entry.entity);
                              const isEditing = editingKey === key;
                              const isMutating = mutating === key;

                              return (
                                <div
                                  key={`${dim}-${entry.entity}-${i}`}
                                  className="group flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-gray-50/80 hover:bg-gray-50 transition-colors"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <SentimentIcon score={isEditing ? editingScore : entry.avg_score} />
                                    <span className="text-sm text-themis-900 truncate">
                                      {entry.entity}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-400 whitespace-nowrap">
                                      {entry.mention_count}x
                                    </span>

                                    {isEditing ? (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          onClick={() => setEditingScore(prev => Math.round(Math.max(-1, prev - 0.1) * 10) / 10)}
                                          className="p-0.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                                        >
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        </button>
                                        <span className={`text-xs font-mono w-10 text-center ${
                                          editingScore > 0.05 ? 'text-emerald-600' : editingScore < -0.05 ? 'text-red-600' : 'text-gray-500'
                                        }`}>
                                          {editingScore > 0 ? '+' : ''}{editingScore.toFixed(1)}
                                        </span>
                                        <button
                                          onClick={() => setEditingScore(prev => Math.round(Math.min(1, prev + 0.1) * 10) / 10)}
                                          className="p-0.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                                        >
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleScoreSave(entry)}
                                          disabled={isMutating}
                                          className="p-1 rounded hover:bg-emerald-100 text-emerald-600 transition-colors"
                                        >
                                          {isMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                        </button>
                                        <button
                                          onClick={() => setEditingKey(null)}
                                          className="p-1 rounded hover:bg-gray-200 text-gray-400 transition-colors"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setEditingKey(key);
                                          setEditingScore(Math.round(entry.avg_score * 10) / 10);
                                        }}
                                        className="cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1 transition-colors"
                                        title="Click to adjust score"
                                      >
                                        <ScoreBar score={entry.avg_score} />
                                      </button>
                                    )}

                                    <button
                                      onClick={() => handleDelete(entry)}
                                      disabled={isMutating}
                                      className="p-1 rounded text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                                      title="Remove entity"
                                    >
                                      {isMutating && mutating === key && !isEditing ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
