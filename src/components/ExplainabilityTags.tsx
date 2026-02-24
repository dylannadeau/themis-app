'use client';

import { ScoreExplanation } from '@/lib/personalization';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ExplainabilityTagsProps {
  explanations: ScoreExplanation[];
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

export default function ExplainabilityTags({ explanations }: ExplainabilityTagsProps) {
  if (!explanations || explanations.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {explanations.map((exp, i) => {
        const isPositive = exp.weighted_contribution > 0;
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
              isPositive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                : 'bg-red-50 text-red-600 border border-red-200/60'
            }`}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <span className="text-[9px] uppercase tracking-wider opacity-60">
              {dimensionLabels[exp.dimension] || exp.dimension}
            </span>
            {exp.entity}
            <span className="font-mono text-[9px] opacity-70">
              {exp.avg_score > 0 ? '+' : ''}{exp.avg_score.toFixed(1)}
            </span>
          </span>
        );
      })}
    </div>
  );
}
