export interface Case {
  id: string;
  entity: string;
  source: string;
  docket_number: string;
  filed: string;
  updated: string;
  case_name: string;
  case_type: string | null;
  court_name: string | null;
  status: string;
  nature_of_suit: string | null;
  cause_of_action: string | null;
  demand: string | null;
  judge: string | null;
  plaintiffs: string[] | null;
  defendants: string[] | null;
  attorneys: string[] | null;
  complaint_text: string | null;
  complaint_summary: string | null;
  blaw_url: string | null;
  date_logged: string;
}

export interface ConsultantResult {
  id: number;
  case_id: string;
  case_viability: 'high' | 'medium' | 'low' | null;
  viability_reasoning: string | null;
  person_1: string | null;
  score_1: number | null;
  explanation_1: string | null;
  person_2: string | null;
  score_2: number | null;
  explanation_2: string | null;
  person_3: string | null;
  score_3: number | null;
  explanation_3: string | null;
  created_at: string;
}

export interface UserReaction {
  id: number;
  user_id: string;
  case_id: string;
  reaction: 1 | -1;
  created_at: string;
}

export interface UserPreference {
  id: number;
  user_id: string;
  feature_key: string;
  feature_value: string;
  weight: number;
}

export interface UserSettings {
  user_id: string;
  api_key_encrypted: string | null;
  model_preference: string;
  created_at: string;
  updated_at: string;
}

export interface CaseWithResult extends Case {
  consultant_results?: ConsultantResult;
  user_reaction?: UserReaction | null;
  user_favorite?: boolean;
  relevance_score?: number;
}

export interface SearchResult {
  cases: CaseWithResult[];
  synthesis?: string | null;
  query: string;
  total_count: number;
}

export type Viability = 'high' | 'medium' | 'low';

export const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast and affordable' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Latest fast model' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Lightest and cheapest' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable, higher cost' },
] as const;

export const VALID_SUMMARY_FILTER = `complaint_summary.not.is.null,complaint_summary.neq.,complaint_summary.neq.No complaint found,complaint_summary.neq.ERROR,complaint_summary.neq.Failed to fetch pleadings.`;
