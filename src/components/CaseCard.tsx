'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ThumbsUp, ThumbsDown, ExternalLink, Calendar, Gavel, Bookmark, MessageSquare, RefreshCw } from 'lucide-react';
import { CaseWithResult } from '@/lib/types';
import { ScoredCase } from '@/lib/personalization';
import { createClient } from '@/lib/supabase-browser';
import NarrativeFeedback from './NarrativeFeedback';
import ExplainabilityTags from './ExplainabilityTags';

interface CaseCardProps {
  caseData: ScoredCase;
  onReactionChange?: (caseId: string, reaction: 1 | -1 | null) => void;
  onFavoriteChange?: (caseId: string, favorited: boolean) => void;
  score?: number | null;
  scoreReasoning?: string | null;
  scoreSource?: 'cluster' | 'direct' | null;
  scoreStale?: boolean;
  caseViability?: 'high' | 'medium' | 'low' | null;
  viabilityReasoning?: string | null;
}

function ScoreBadge({
  score,
  source,
  stale,
  reasoning,
}: {
  score?: number | null;
  source?: 'cluster' | 'direct' | null;
  stale?: boolean;
  reasoning?: string | null;
}) {
  let colorClasses: string;
  let display: string;

  if (score == null) {
    colorClasses = 'bg-gray-50 text-gray-300 border border-gray-200/60';
    display = '\u2014';
  } else if (score >= 8) {
    colorClasses = 'bg-emerald-50 text-emerald-700 border border-emerald-200/60';
    display = source === 'cluster' ? `~${score}` : `${score}`;
  } else if (score >= 5) {
    colorClasses = 'bg-amber-50 text-amber-700 border border-amber-200/60';
    display = source === 'cluster' ? `~${score}` : `${score}`;
  } else {
    colorClasses = 'bg-gray-100 text-gray-500 border border-gray-200/60';
    display = source === 'cluster' ? `~${score}` : `${score}`;
  }

  return (
    <span
      className={`min-w-[2.5rem] h-7 flex items-center justify-center rounded-lg text-sm font-bold flex-shrink-0 ${colorClasses} ${stale ? 'opacity-60' : ''}`}
      title={reasoning || (score != null ? `Relevance score: ${score}/10` : 'Not scored yet')}
    >
      {display}
      {stale && <RefreshCw className="w-3 h-3 ml-0.5" />}
    </span>
  );
}

function ViabilityBadge({
  viability,
  reasoning,
}: {
  viability?: 'high' | 'medium' | 'low' | null;
  reasoning?: string | null;
}) {
  if (!viability) return null;

  const config = {
    high: { classes: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60', label: 'High Viability' },
    medium: { classes: 'bg-amber-50 text-amber-700 border border-amber-200/60', label: 'Medium Viability' },
    low: { classes: 'bg-gray-100 text-gray-500 border border-gray-200/60', label: 'Low Viability' },
  };

  const { classes, label } = config[viability];

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider ${classes}`}
      title={reasoning || label}
    >
      {label}
    </span>
  );
}

export default function CaseCard({
  caseData,
  onReactionChange,
  onFavoriteChange,
  score,
  scoreReasoning,
  scoreSource,
  scoreStale,
  caseViability,
  viabilityReasoning,
}: CaseCardProps) {
  const [currentReaction, setCurrentReaction] = useState<1 | -1 | null>(
    caseData.user_reaction?.reaction ?? null
  );
  const [isFavorited, setIsFavorited] = useState(caseData.user_favorite ?? false);
  const [isReacting, setIsReacting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);
  const supabase = createClient();

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
        body: JSON.stringify({ case_id: caseData.id, reaction: newReaction }),
      });

      if (!response.ok) throw new Error('Failed to update reaction');

      setCurrentReaction(newReaction);
      onReactionChange?.(caseData.id, newReaction);
    } catch (error) {
      console.error('Failed to update reaction:', error);
    } finally {
      setIsReacting(false);
    }
  };

  const handleFavorite = async () => {
    setIsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      if (isFavorited) {
        await supabase
          .from('user_favorites')
          .delete()
          .eq('user_id', session.user.id)
          .eq('case_id', caseData.id);
      } else {
        await supabase
          .from('user_favorites')
          .upsert({ user_id: session.user.id, case_id: caseData.id }, { onConflict: 'user_id,case_id' });
      }

      setIsFavorited(!isFavorited);
      onFavoriteChange?.(caseData.id, !isFavorited);
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card-hover p-5 group">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <Link
            href={`/cases/${caseData.id}`}
            className="font-semibold text-themis-900 text-[15px] leading-snug hover:text-themis-600 transition-colors line-clamp-2"
          >
            {caseData.case_name}
          </Link>
        </div>
        <ScoreBadge
          score={score}
          source={scoreSource}
          stale={scoreStale}
          reasoning={scoreReasoning}
        />
      </div>

      {/* Meta info */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-gray-500">
        {caseData.court_name && (
          <span className="flex items-center gap-1">
            <Gavel className="w-3 h-3" />
            <span className="truncate max-w-[200px]">{caseData.court_name}</span>
          </span>
        )}
        {caseData.nature_of_suit && (
          <span className="truncate max-w-[200px]">{caseData.nature_of_suit}</span>
        )}
        {caseData.filed && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {new Date(caseData.filed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
        <ViabilityBadge viability={caseViability} reasoning={viabilityReasoning} />
      </div>

      {/* Summary snippet */}
      {caseData.complaint_summary && (
        <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 mb-2">
          {caseData.complaint_summary}
        </p>
      )}

      {/* Explainability tags */}
      {caseData.explanations && caseData.explanations.length > 0 && (
        <div className="mb-3">
          <ExplainabilityTags explanations={caseData.explanations} />
        </div>
      )}

      {/* Narrative Feedback (expandable) */}
      {showNarrative && (
        <div className="mb-3 p-3 bg-gray-50/50 rounded-lg border border-gray-100 animate-slide-down">
          <NarrativeFeedback caseId={caseData.id} compact={false} />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-50">
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleReaction(1)}
            disabled={isReacting}
            className={`p-2 rounded-lg transition-all duration-200 ${
              currentReaction === 1
                ? 'bg-emerald-50 text-emerald-600 shadow-sm'
                : 'text-gray-300 hover:text-emerald-500 hover:bg-emerald-50/50'
            }`}
            title="Like this case"
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleReaction(-1)}
            disabled={isReacting}
            className={`p-2 rounded-lg transition-all duration-200 ${
              currentReaction === -1
                ? 'bg-red-50 text-red-500 shadow-sm'
                : 'text-gray-300 hover:text-red-400 hover:bg-red-50/50'
            }`}
            title="Dislike this case"
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowNarrative(!showNarrative)}
            className={`p-2 rounded-lg transition-all duration-200 ${
              showNarrative
                ? 'bg-themis-50 text-themis-600 shadow-sm'
                : 'text-gray-300 hover:text-themis-500 hover:bg-themis-50/50'
            }`}
            title="Add detailed feedback"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={handleFavorite}
            disabled={isSaving}
            className={`p-2 rounded-lg transition-all duration-200 ${
              isFavorited
                ? 'bg-amber-50 text-amber-500 shadow-sm'
                : 'text-gray-300 hover:text-amber-400 hover:bg-amber-50/50'
            }`}
            title={isFavorited ? 'Remove from favorites' : 'Save to favorites'}
          >
            <Bookmark className={`w-4 h-4 ${isFavorited ? 'fill-current' : ''}`} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {caseData.blaw_url && (
            <a
              href={caseData.blaw_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost text-xs text-gray-400 gap-1 hover:text-themis-600"
            >
              <ExternalLink className="w-3 h-3" />
              Bloomberg
            </a>
          )}
          <Link
            href={`/cases/${caseData.id}`}
            className="btn-ghost text-xs text-themis-500 hover:text-themis-700"
          >
            View Details →
          </Link>
        </div>
      </div>
    </div>
  );
}
