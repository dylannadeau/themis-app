import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

const FEATURE_KEYS = ['nature_of_suit', 'cause_of_action', 'entity', 'source', 'court_name', 'judge'];

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { case_id, reaction } = await request.json();
    if (!case_id || (reaction !== 1 && reaction !== -1 && reaction !== null)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const userId = session.user.id;

    // Get previous reaction
    const { data: existing } = await supabase
      .from('user_reactions')
      .select('reaction')
      .eq('user_id', userId)
      .eq('case_id', case_id)
      .single();

    const previousReaction = existing?.reaction ?? null;

    // Update or remove reaction
    if (reaction === null) {
      await supabase
        .from('user_reactions')
        .delete()
        .eq('user_id', userId)
        .eq('case_id', case_id);
    } else {
      await supabase
        .from('user_reactions')
        .upsert(
          { user_id: userId, case_id, reaction },
          { onConflict: 'user_id,case_id' }
        );
    }

    // Update user_preferences based on case metadata
    const { data: caseData } = await supabase
      .from('cases')
      .select('nature_of_suit, cause_of_action, entity, source, court_name, judge')
      .eq('id', case_id)
      .single();

    if (caseData) {
      for (const key of FEATURE_KEYS) {
        const value = (caseData as any)[key];
        if (!value || typeof value !== 'string' || !value.trim()) continue;

        // Calculate delta
        let delta: number;
        if (reaction === null) {
          // Removing reaction: reverse the previous
          delta = previousReaction ? -previousReaction : 0;
        } else if (previousReaction) {
          // Changing reaction: reverse previous and apply new
          delta = reaction - previousReaction;
        } else {
          // New reaction
          delta = reaction;
        }

        if (delta === 0) continue;

        // Upsert preference weight
        const { data: existingPref } = await supabase
          .from('user_preferences')
          .select('id, weight')
          .eq('user_id', userId)
          .eq('feature_key', key)
          .eq('feature_value', value.trim())
          .single();

        if (existingPref) {
          await supabase
            .from('user_preferences')
            .update({ weight: existingPref.weight + delta })
            .eq('id', existingPref.id);
        } else {
          await supabase
            .from('user_preferences')
            .insert({
              user_id: userId,
              feature_key: key,
              feature_value: value.trim(),
              weight: delta,
            });
        }
      }
    }

    return NextResponse.json({ success: true, reaction });
  } catch (err: any) {
    console.error('React error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
