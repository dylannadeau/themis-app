import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  // Fetch all three tables in parallel
  const [profileResult, weightsResult, narrativeCountResult] = await Promise.all([
    supabase
      .from('user_preference_profile')
      .select('dimension, entity, cumulative_score, mention_count, avg_score')
      .eq('user_id', userId)
      .order('mention_count', { ascending: false }),
    supabase
      .from('user_dimension_weights')
      .select('dimension, total_mentions, weight')
      .eq('user_id', userId),
    supabase
      .from('user_narratives')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  return NextResponse.json({
    profile: profileResult.data || [],
    dimension_weights: weightsResult.data || [],
    narrative_count: narrativeCountResult.count ?? 0,
  });
}
