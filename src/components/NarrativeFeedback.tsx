'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { MessageSquare, Loader2, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';

interface Signal {
  dimension: string;
  entity: string;
  score: number;
}

interface NarrativeFeedbackProps {
  caseId: string;
  compact?: boolean; // For use in CaseCard (collapsed by default)
  onSubmitSuccess?: () => void;
}

const dimensionLabels: Record<string, string> = {
  firm: 'Firm',
  attorney: 'Attorney',
  client: 'Client',
  practice_area: 'Practice Area',
  case_type: 'Case Type',
  jurisdiction: 'Jurisdiction',
  judge: 'Judge',
  topic: 'Topic',
};

function SignalBadge({ signal }: { signal: Signal }) {
  const isPositive = signal.score > 0;
  const isNeutral = signal.score === 0;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        isPositive
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
          : isNeutral
          ? 'bg-gray-50 text-gray-600 border border-gray-200/60'
          : 'bg-red-50 text-red-600 border border-red-200/60'
      }`}
    >
      <span className="text-[10px] uppercase tracking-wider text-gray-400">
        {dimensionLabels[signal.dimension] || signal.dimension}
      </span>
      {signal.entity}
      <span className="font-mono text-[10px]">
        {isPositive ? '+' : ''}{signal.score.toFixed(1)}
      </span>
    </span>
  );
}

export default function NarrativeFeedback({ caseId, compact = false, onSubmitSuccess }: NarrativeFeedbackProps) {
  const [narrative, setNarrative] = useState('');
  const [savedNarrative, setSavedNarrative] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [isOpen, setIsOpen] = useState(!compact);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  // Fetch existing narrative on mount
  useEffect(() => {
    async function fetchExisting() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const response = await fetch(`/api/narrative?case_id=${caseId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.narrative) {
            setSavedNarrative(data.narrative.narrative);
            setNarrative(data.narrative.narrative);
          }
          if (data.signals) {
            setSignals(data.signals);
          }
        }
      } catch (err) {
        console.error('Failed to fetch narrative:', err);
      } finally {
        setFetching(false);
      }
    }

    fetchExisting();
  }, [caseId, supabase]);

  const handleSubmit = async () => {
    if (!narrative.trim()) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/narrative', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ case_id: caseId, narrative: narrative.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save feedback');
      }

      setSavedNarrative(narrative.trim());
      setSignals(data.signals || []);
      setSuccess(true);
      onSubmitSuccess?.();

      if (data.extraction_failed) {
        setError('Feedback saved, but preference extraction failed. It will be retried later.');
      } else if (data.extraction_skipped) {
        setError('Feedback saved. Add an API key in Settings to enable automatic preference extraction.');
      }

      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading feedback...
      </div>
    );
  }

  // Compact mode: show as a toggle button
  if (compact && !isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
          savedNarrative
            ? 'bg-themis-50 text-themis-700 border border-themis-200'
            : 'text-gray-400 hover:text-themis-600 hover:bg-themis-50/50 border border-transparent'
        }`}
      >
        <MessageSquare className={`w-4 h-4 ${savedNarrative ? 'fill-themis-200' : ''}`} />
        {savedNarrative ? 'Edit Feedback' : 'Add Feedback'}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-medium text-themis-800">
          <MessageSquare className="w-4 h-4" />
          Your Feedback
        </label>
        {compact && (
          <button
            onClick={() => setIsOpen(false)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Collapse
          </button>
        )}
      </div>

      <textarea
        value={narrative}
        onChange={(e) => setNarrative(e.target.value)}
        placeholder="What do you think about this case? E.g., &quot;I like the firm involved but the practice area isn't relevant to our work. The judge has a strong track record.&quot;"
        className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-themis-950
                   placeholder:text-gray-400 resize-none
                   focus:outline-none focus:ring-2 focus:ring-themis-500/20 focus:border-themis-400
                   transition-all duration-200"
        rows={3}
        disabled={loading}
      />

      <div className="flex items-center justify-between">
        <button
          onClick={handleSubmit}
          disabled={loading || !narrative.trim() || narrative.trim() === savedNarrative}
          className="btn-primary text-xs py-2 px-4 gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              {savedNarrative ? 'Update Feedback' : 'Submit Feedback'}
            </>
          )}
        </button>

        {success && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 animate-slide-down">
            <CheckCircle className="w-3 h-3" />
            Saved & analyzed
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Show extracted signals */}
      {signals.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">
            Extracted Preferences
          </p>
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s, i) => (
              <SignalBadge key={i} signal={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
