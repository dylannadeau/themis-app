'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import { CaseWithResult } from '@/lib/types';
import {
  ArrowLeft, ThumbsUp, ThumbsDown, ExternalLink, User, Calendar,
  Gavel, FileText, Loader2, MapPin, Scale, Users
} from 'lucide-react';
import Link from 'next/link';

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

function ConsultantCard({
  rank,
  name,
  score,
  explanation,
}: {
  rank: number;
  name: string | null;
  score: number | null;
  explanation: string | null;
}) {
  if (!name) return null;
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-lg bg-themis-50/50 border border-themis-100/50">
      <div className="w-7 h-7 rounded-full bg-themis-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-themis-900">{name}</span>
          {score && (
            <span className="text-xs font-mono font-semibold text-themis-600 bg-white px-2 py-0.5 rounded border border-themis-100">
              {score}/10
            </span>
          )}
        </div>
        {explanation && <p className="text-xs text-gray-600 leading-relaxed">{explanation}</p>}
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

  useEffect(() => {
    async function fetchCase() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/auth'); return; }

      const { data, error } = await supabase
        .from('cases')
        .select('*, consultant_results(*)')
        .eq('id', caseId)
        .single();

      if (error || !data) {
        router.push('/dashboard');
        return;
      }

      const { data: reaction } = await supabase
        .from('user_reactions')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('case_id', caseId)
        .single();

      setCaseData({
        ...data,
        consultant_results: data.consultant_results?.[0] || null,
        user_reaction: reaction || null,
      });
      setCurrentReaction(reaction?.reaction ?? null);
      setLoading(false);
    }

    fetchCase();
  }, [caseId, router, supabase]);

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

  const result = caseData.consultant_results;
  const viabilityClass = {
    high: 'badge-high',
    medium: 'badge-medium',
    low: 'badge-low',
  }[result?.case_viability || ''] || '';

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
            <div className="flex items-center gap-2 flex-shrink-0">
              {result?.case_viability && (
                <span className={viabilityClass}>{result.case_viability}</span>
              )}
            </div>
          </div>

          {/* Reaction buttons */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 mr-2">Rate this case:</span>
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

        {/* Complaint Summary */}
        {caseData.complaint_summary && (
          <div className="card p-6 mb-6">
            <h2 className="font-display text-lg text-themis-900 mb-4">Complaint Summary</h2>
            <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
              {caseData.complaint_summary}
            </div>
          </div>
        )}

        {/* Consultant Rankings */}
        {result && (
          <div className="card p-6 mb-6">
            <h2 className="font-display text-lg text-themis-900 mb-2">Consultant Rankings</h2>
            {result.viability_reasoning && (
              <p className="text-sm text-gray-600 mb-4 italic">{result.viability_reasoning}</p>
            )}
            <div className="space-y-3">
              <ConsultantCard rank={1} name={result.person_1} score={result.score_1} explanation={result.explanation_1} />
              <ConsultantCard rank={2} name={result.person_2} score={result.score_2} explanation={result.explanation_2} />
              <ConsultantCard rank={3} name={result.person_3} score={result.score_3} explanation={result.explanation_3} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
