import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { rebuildPreferenceProfile } from '@/lib/preference-utils';

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

  if (profileResult.error) {
    console.error('Failed to fetch preference profile:', profileResult.error.message);
  }
  if (weightsResult.error) {
    console.error('Failed to fetch dimension weights:', weightsResult.error.message);
  }

  // Auto-repair: if weights exist but profile is empty, rebuild from signals
  const profile = profileResult.data || [];
  const weights = weightsResult.data || [];
  if (profile.length === 0 && weights.length > 0) {
    console.log('Detected inconsistent preference data — rebuilding profile from signals');
    await rebuildPreferenceProfile(supabase, userId);

    // Re-fetch after rebuild
    const [rebuiltProfile, rebuiltWeights] = await Promise.all([
      supabase
        .from('user_preference_profile')
        .select('dimension, entity, cumulative_score, mention_count, avg_score')
        .eq('user_id', userId)
        .order('mention_count', { ascending: false }),
      supabase
        .from('user_dimension_weights')
        .select('dimension, total_mentions, weight')
        .eq('user_id', userId),
    ]);

    return NextResponse.json({
      profile: rebuiltProfile.data || [],
      dimension_weights: rebuiltWeights.data || [],
      narrative_count: narrativeCountResult.count ?? 0,
    });
  }

  return NextResponse.json({
    profile,
    dimension_weights: weights,
    narrative_count: narrativeCountResult.count ?? 0,
  });
}

export async function DELETE(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const { dimension, entity } = await request.json();

  if (!dimension || !entity) {
    return NextResponse.json({ error: 'dimension and entity are required' }, { status: 400 });
  }

  // Look up the mention_count before deleting so we can adjust dimension weights
  const { data: profileRow } = await supabase
    .from('user_preference_profile')
    .select('mention_count')
    .eq('user_id', userId)
    .eq('dimension', dimension)
    .eq('entity', entity)
    .single();

  if (!profileRow) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
  }

  const mentionsToRemove = profileRow.mention_count;

  // Delete from profile and signals in parallel
  const [profileDel, signalsDel] = await Promise.all([
    supabase
      .from('user_preference_profile')
      .delete()
      .eq('user_id', userId)
      .eq('dimension', dimension)
      .eq('entity', entity),
    supabase
      .from('preference_signals')
      .delete()
      .eq('user_id', userId)
      .eq('dimension', dimension)
      .eq('entity', entity),
  ]);

  if (profileDel.error) {
    return NextResponse.json({ error: profileDel.error.message }, { status: 500 });
  }

  // Update dimension weight: decrement total_mentions, recalculate weight
  const { data: currentWeight } = await supabase
    .from('user_dimension_weights')
    .select('total_mentions')
    .eq('user_id', userId)
    .eq('dimension', dimension)
    .single();

  if (currentWeight) {
    const newMentions = currentWeight.total_mentions - mentionsToRemove;

    if (newMentions <= 0) {
      // Remove the dimension weight row entirely
      await supabase
        .from('user_dimension_weights')
        .delete()
        .eq('user_id', userId)
        .eq('dimension', dimension);
    } else {
      // Update this dimension's total_mentions first
      await supabase
        .from('user_dimension_weights')
        .update({ total_mentions: newMentions })
        .eq('user_id', userId)
        .eq('dimension', dimension);
    }

    // Recalculate all weights proportionally
    const { data: allWeights } = await supabase
      .from('user_dimension_weights')
      .select('dimension, total_mentions')
      .eq('user_id', userId);

    if (allWeights && allWeights.length > 0) {
      const grandTotal = allWeights.reduce((sum, w) => sum + w.total_mentions, 0);
      for (const w of allWeights) {
        const newWeight = grandTotal > 0 ? w.total_mentions / grandTotal : 0;
        await supabase
          .from('user_dimension_weights')
          .update({ weight: newWeight })
          .eq('user_id', userId)
          .eq('dimension', w.dimension);
      }
    }
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const { dimension, entity, avg_score } = await request.json();

  if (!dimension || !entity || avg_score === undefined) {
    return NextResponse.json({ error: 'dimension, entity, and avg_score are required' }, { status: 400 });
  }

  const clampedScore = Math.max(-1, Math.min(1, Number(avg_score)));

  // Look up current mention_count to recalculate cumulative_score
  const { data: profileRow } = await supabase
    .from('user_preference_profile')
    .select('mention_count')
    .eq('user_id', userId)
    .eq('dimension', dimension)
    .eq('entity', entity)
    .single();

  if (!profileRow) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
  }

  const newCumulative = clampedScore * profileRow.mention_count;

  const { error: updateError } = await supabase
    .from('user_preference_profile')
    .update({
      avg_score: clampedScore,
      cumulative_score: newCumulative,
    })
    .eq('user_id', userId)
    .eq('dimension', dimension)
    .eq('entity', entity);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, avg_score: clampedScore, cumulative_score: newCumulative });
}
