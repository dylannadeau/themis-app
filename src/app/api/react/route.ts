import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import {
  createReactionSignals,
  deleteReactionSignals,
  rebuildPreferenceProfile,
  markScoresStale,
} from '@/lib/preference-utils';

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

    // Update preference signals
    if (reaction === 1 || reaction === -1) {
      await deleteReactionSignals(supabase, userId, case_id);
      await createReactionSignals(supabase, userId, case_id, reaction);
      await rebuildPreferenceProfile(supabase, userId);
      await markScoresStale(supabase, userId);
    } else {
      // reaction === null (removing reaction)
      await deleteReactionSignals(supabase, userId, case_id);
      await rebuildPreferenceProfile(supabase, userId);
      await markScoresStale(supabase, userId);
    }

    return NextResponse.json({ success: true, reaction });
  } catch (err: any) {
    console.error('React error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
