import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { encrypt, maskApiKey } from '@/lib/encryption';
import { markScoresStale } from '@/lib/preference-utils';
import { validateApiKey } from '@/lib/ai-provider';
import { type AIProvider } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data } = await supabase
      .from('user_settings')
      .select('model_preference, api_key_masked, anthropic_key_masked, ai_provider, bio_text, bio_updated_at, created_at, updated_at')
      .eq('user_id', session.user.id)
      .single();

    return NextResponse.json({
      has_api_key: !!(data?.api_key_masked || data?.anthropic_key_masked),
      masked_key: data?.api_key_masked || null,
      anthropic_masked_key: data?.anthropic_key_masked || null,
      ai_provider: data?.ai_provider || 'gemini',
      model_preference: data?.model_preference || 'gemini-2.0-flash',
      bio_text: data?.bio_text || null,
      bio_updated_at: data?.bio_updated_at || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { api_key, anthropic_key, ai_provider, model_preference, bio_text } = await request.json();
    const userId = session.user.id;

    const updateData: any = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    // Handle AI provider selection
    if (ai_provider !== undefined) {
      updateData.ai_provider = ai_provider;
    }

    // Handle model preference
    if (model_preference !== undefined) {
      updateData.model_preference = model_preference;
    }

    // Handle bio update
    if (bio_text !== undefined) {
      updateData.bio_text = bio_text;
      updateData.bio_updated_at = new Date().toISOString();
    }

    // Handle Gemini API key
    if (api_key === null) {
      updateData.api_key_encrypted = null;
      updateData.api_key_masked = null;
    } else if (api_key && typeof api_key === 'string' && api_key.trim()) {
      const trimmedKey = api_key.trim();

      const validation = await validateApiKey('gemini', trimmedKey);
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid Gemini API key: ${validation.error}` },
          { status: 400 },
        );
      }

      try {
        updateData.api_key_encrypted = encrypt(trimmedKey);
      } catch (encErr: any) {
        console.error('Encryption error:', encErr);
        return NextResponse.json(
          { error: 'Server configuration error: encryption key is missing or invalid.' },
          { status: 500 },
        );
      }
      updateData.api_key_masked = maskApiKey(trimmedKey);
    }

    // Handle Anthropic API key
    if (anthropic_key === null) {
      updateData.anthropic_key_encrypted = null;
      updateData.anthropic_key_masked = null;
    } else if (anthropic_key && typeof anthropic_key === 'string' && anthropic_key.trim()) {
      const trimmedKey = anthropic_key.trim();

      const validation = await validateApiKey('anthropic', trimmedKey);
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid Anthropic API key: ${validation.error}` },
          { status: 400 },
        );
      }

      try {
        updateData.anthropic_key_encrypted = encrypt(trimmedKey);
      } catch (encErr: any) {
        console.error('Encryption error:', encErr);
        return NextResponse.json(
          { error: 'Server configuration error: encryption key is missing or invalid.' },
          { status: 500 },
        );
      }
      updateData.anthropic_key_masked = maskApiKey(trimmedKey);
    }

    const { error } = await supabase
      .from('user_settings')
      .upsert(updateData, { onConflict: 'user_id' });

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: `Failed to save settings: ${error.message}` },
        { status: 500 },
      );
    }

    // Mark scores stale when bio or provider changes (affects relevance scoring)
    if (bio_text !== undefined || ai_provider !== undefined) {
      await markScoresStale(supabase, userId);
    }

    return NextResponse.json({
      success: true,
      masked_key: updateData.api_key_masked ?? undefined,
      anthropic_masked_key: updateData.anthropic_key_masked ?? undefined,
      ai_provider: updateData.ai_provider ?? undefined,
      model_preference: updateData.model_preference ?? undefined,
      bio_text: updateData.bio_text ?? undefined,
    });
  } catch (err: any) {
    console.error('Settings error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
