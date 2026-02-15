'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ThumbsUp, ThumbsDown, ExternalLink, User, Calendar, Gavel, Bookmark } from 'lucide-react';
import { CaseWithResult, Viability } from '@/lib/types';
import { createClient } from '@/lib/supabase-browser';

function ViabilityBadge({ viability }: { viability: Viability | null }) {
  if (!viability) return null;
  const classes = {
    high: 'badge-high',
    medium: 'badge-medium',
    low: 'badge-low',
  };
  return <span className={classes[viability]}>{viability}</span>;
}

interface CaseCardProps {
  caseData: CaseWithResult;
  onReactionChange?: (caseId: string, reaction: 1 | -1 | null) => void;
  onFavoriteChange?: (caseId: string, favorited: boolean) => void;
}

export default function CaseCard({ caseData, onReactionChange, onFavoriteChange }: CaseCardProps) {
  const [currentReaction, setCurrentReaction] = useState<1 | -1 | null>(
    caseData.user_reaction?.reaction ?? null
  );
  const [isFavorited, setIsFavorited] = useState(caseData.user_favorite ?? false);
  const [isReacting, setIsReacting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const supabase = createClient();

  const handleReaction = async (reaction: 1 | -1) => {
    setIsReacting(true);
    const newReaction = currentReaction === reaction ? null : reaction;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Call the /api/react route so preference weights get updated
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

  const result = caseData.consultant_results;
  const topScore = result?.score_1;

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
        <div className="flex items-center gap-2 flex-shrink-0">
          <ViabilityBadge viability={result?.case_viability ?? null} />
          {topScore && (
            <span className="text-xs font-mono font-semibold text-themis-600 bg-themis-50 px-2 py-0.5 rounded">
              {topScore.toFixed(0)}/10
            </span>
          )}
        </div>
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
      </div>

      {/* Summary snippet */}
      {caseData.complaint_summary && (
        <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 mb-3">
          {caseData.complaint_summary}
        </p>
      )}

      {/* Top consultant match */}
      {result?.person_1 && (
        <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-themis-50/50 rounded-lg border border-themis-100/50">
          <User className="w-3.5 h-3.5 text-themis-500 flex-shrink-0" />
          <span className="text-xs text-themis-700">
            <span className="font-semibold">{result.person_1}</span>
            {result.explanation_1 && (
              <span className="text-themis-500 ml-1.5">— {result.explanation_1.slice(0, 120)}...</span>
            )}
          </span>
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
