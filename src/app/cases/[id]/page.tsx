'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import NarrativeFeedback from '@/components/NarrativeFeedback';
import { CaseWithResult } from '@/lib/types';
import {
  ArrowLeft, ThumbsUp, ThumbsDown, ExternalLink, Calendar,
  Gavel, FileText, Loader2, MapPin, Scale, Users, Shield, RefreshCw
} from 'lucide-react';

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="w-4 h-4 text-themis-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-themis-900 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

interface ScoreData {
  score: number;
  reasoning: string | null;
  source: string;
  stale: boolean;
}

function ScoreBadgeLarge({ scoreData, loading }: { scoreData: ScoreData | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-3">
        <span className="min-w-[3rem] h-9 flex items-center justify-center rounded-xl bg-gray-100 border border-gray-200/60 animate-pulse">
          <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
        </span>
        <div className="text-xs text-gray-400">
          <p className="font-medium">Scoring...</p>
        </div>
      </div>
    );
  }

  if (!scoreData) return null;

  const { score, source, stale, reasoning } = scoreData;
  let colorClasses: string;

  if (score >= 8) {
    colorClasses = 'bg-emerald-50 text-emerald-700 border border-emerald-200/60';
  } else if (score >= 5) {
    colorClasses = 'bg-amber-50 text-amber-700 border border-amber-200/60';
  } else {
    colorClasses = 'bg-gray-100 text-gray-500 border border-gray-200/60';
  }

  const display = `${score}`;

  return (
    <div className="flex items-center gap-3 animate-fade-in">
      <span
        className={`min-w-[3rem] h-9 flex items-center justify-center rounded-xl text-base font-bold ${colorClasses} ${stale ? 'opacity-60' : ''}`}
        title={reasoning || `Relevance score: ${score}/10`}
      >
        {display}
        {stale && <RefreshCw className="w-3 h-3 ml-1" />}
      </span>
      <div className="text-xs text-gray-500">
        <p className="font-medium">Relevance: {score}/10</p>
        {reasoning && <p className="mt-0.5 text-gray-400">{reasoning}</p>}
      </div>
    </div>
  );
}

function ViabilityRow({ viability, reasoning }: { viability: string | null; reasoning: string | null }) {
  if (!viability) return null;

  const config: Record<string, { color: string; label: string }> = {
    high: { color: 'text-emerald-700', label: 'High' },
    medium: { color: 'text-amber-700', label: 'Medium' },
    low: { color: 'text-gray-500', label: 'Low' },
  };

  const { color, label } = config[viability] || { color: 'text-gray-500', label: viability };

  return (
    <div className="flex items-start gap-3 py-2.5">
      <Shield className="w-4 h-4 text-themis-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider">Case Viability</p>
        <p className={`text-sm font-medium mt-0.5 ${color}`}>{label}</p>
        {reasoning && <p className="text-xs text-gray-400 mt-0.5">{reasoning}</p>}
      </div>
    </div>
  );
}

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = params.id as string;
  const router = useRouter();
  const supabase = createClient();

  const [caseData, setCaseData] = useState<CaseWithResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentReaction, setCurrentReaction] = useState<1 | -1 | null>(null);
  const [isReacting, setIsReacting] = useState(false);
  const [scoreData, setScoreData] = useState<ScoreData | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [viabilityData, setViabilityData] = useState<{ case_viability: string | null; viability_reasoning: string | null }>({ case_viability: null, viability_reasoning: null });
  const autoScoreTriggered = useRef(false);

  const triggerAutoScore = useCallback(async () => {
    if (autoScoreTriggered.current) return;
    autoScoreTriggered.current = true;

    setScoreLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/score-cases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ case_ids: [caseId] }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.scores && result.scores.length > 0) {
          const s = result.scores[0];
          setScoreData({
            score: s.score,
            reasoning: s.reasoning,
            source: 'direct',
            stale: false,
          });
        }
      }
    } catch {
      // Silently fail — auto-scoring is best-effort
    } finally {
      setScoreLoading(false);
    }
  }, [caseId, supabase]);

  useEffect(() => {
    async function fetchCase() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/auth'); return; }

      const { data, error } = await supabase
        .from('cases')
        .select('*')
        .eq('id', caseId)
        .single();

      if (error || !data) {
        router.push('/dashboard');
        return;
      }

      const [reactionResult, scoreResult] = await Promise.all([
        supabase
          .from('user_reactions')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('case_id', caseId)
          .single(),
        supabase
          .from('user_case_scores')
          .select('score, reasoning, source, stale')
          .eq('user_id', session.user.id)
          .eq('case_id', caseId)
          .single(),
      ]);

      setCaseData({
        ...data,
        user_reaction: reactionResult.data || null,
      });
      setCurrentReaction(reactionResult.data?.reaction ?? null);

      const fetchedScore = scoreResult.data || null;
      setScoreData(fetchedScore);

      setViabilityData({
        case_viability: data.case_viability ?? null,
        viability_reasoning: data.viability_reasoning ?? null,
      });

      setLoading(false);

      // Auto-score if no score or stale
      if (!fetchedScore || fetchedScore.stale) {
        triggerAutoScore();
      }
    }

    fetchCase();
  }, [caseId, router, supabase, triggerAutoScore]);

  const handleReaction = async (reaction: 1 | -1) => {
    setIsReacting(true);
    const newReaction = currentReaction === reaction ? null : reaction;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/react', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ case_id: caseId, reaction: newReaction }),
      });

      if (!response.ok) throw new Error('Failed to update reaction');
      setCurrentReaction(newReaction);
    } catch (err) {
      console.error(err);
    } finally {
      setIsReacting(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 text-themis-500 animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!caseData) return null;

  return (
    <AppShell>
      <div className="page-container max-w-4xl">
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="btn-ghost text-gray-500 gap-2 mb-6 -ml-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Case Header */}
        <div className="card p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="font-display text-xl text-themis-900 leading-tight">
              {caseData.case_name}
            </h1>
            <ScoreBadgeLarge scoreData={scoreData} loading={scoreLoading} />
          </div>

          {/* Quick reaction buttons */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 mr-2">Quick rate:</span>
            <button
              onClick={() => handleReaction(1)}
              disabled={isReacting}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                currentReaction === 1
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50/50 border border-transparent'
              }`}
            >
              <ThumbsUp className="w-4 h-4" />
              Like
            </button>
            <button
              onClick={() => handleReaction(-1)}
              disabled={isReacting}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                currentReaction === -1
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'text-gray-400 hover:text-red-500 hover:bg-red-50/50 border border-transparent'
              }`}
            >
              <ThumbsDown className="w-4 h-4" />
              Dislike
            </button>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 divide-y sm:divide-y-0 border-t border-gray-100 pt-2">
            <InfoRow icon={FileText} label="Docket Number" value={caseData.docket_number} />
            <InfoRow icon={Gavel} label="Court" value={caseData.court_name} />
            <InfoRow icon={Scale} label="Nature of Suit" value={caseData.nature_of_suit} />
            <InfoRow icon={FileText} label="Cause of Action" value={caseData.cause_of_action} />
            <InfoRow icon={Calendar} label="Filed" value={caseData.filed ? new Date(caseData.filed).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null} />
            <InfoRow icon={Users} label="Judge" value={caseData.judge} />
            <InfoRow icon={MapPin} label="Entity" value={caseData.entity} />
            <InfoRow icon={FileText} label="Demand" value={caseData.demand} />
            <ViabilityRow
              viability={viabilityData.case_viability}
              reasoning={viabilityData.viability_reasoning}
            />
          </div>

          {caseData.blaw_url && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <a
                href={caseData.blaw_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-sm gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                View on Bloomberg Law
              </a>
            </div>
          )}
        </div>

        {/* Narrative Feedback */}
        <div className="card p-6 mb-6">
          <h2 className="font-display text-lg text-themis-900 mb-4">Your Feedback</h2>
          <p className="text-sm text-gray-500 mb-4">
            Share your thoughts on this case. Your feedback helps personalize future case rankings
            by learning which firms, attorneys, practice areas, and other factors matter to you.
          </p>
          <NarrativeFeedback caseId={caseId} />
        </div>

        {/* Complaint Summary */}
        {caseData.complaint_summary && (
          <div className="card p-6 mb-6">
            <h2 className="font-display text-lg text-themis-900 mb-4">Complaint Summary</h2>
            <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
              {caseData.complaint_summary}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
