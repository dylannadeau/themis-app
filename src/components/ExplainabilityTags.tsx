'use client';

import { ScoreExplanation } from '@/lib/personalization';
import { TrendingUp, TrendingDown, UserCheck } from 'lucide-react';

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
  bio: 'Bio Match',
};

export default function ExplainabilityTags({ explanations }: ExplainabilityTagsProps) {
  if (!explanations || explanations.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {explanations.map((exp, i) => {
        const isPositive = exp.weighted_contribution > 0;
        const isBio = exp.dimension === 'bio';

        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
              isBio
                ? 'bg-themis-50 text-themis-700 border border-themis-200/60'
                : isPositive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                : 'bg-red-50 text-red-600 border border-red-200/60'
            }`}
          >
            {isBio ? (
              <UserCheck className="w-3 h-3" />
            ) : isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <span className="text-[9px] uppercase tracking-wider opacity-60">
              {dimensionLabels[exp.dimension] || exp.dimension}
            </span>
            {exp.entity}
          </span>
        );
      })}
    </div>
  );
}
