import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { encrypt, maskApiKey } from '@/lib/encryption';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data } = await supabase
      .from('user_settings')
      .select('model_preference, api_key_masked, created_at, updated_at')
      .eq('user_id', session.user.id)
      .single();

    return NextResponse.json({
      has_api_key: !!data?.api_key_masked,
      masked_key: data?.api_key_masked || null,
      model_preference: data?.model_preference || 'gemini-2.0-flash',
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

    const { api_key, model_preference } = await request.json();
    const userId = session.user.id;

    const updateData: any = {
      user_id: userId,
      model_preference: model_preference || 'gemini-2.0-flash',
      updated_at: new Date().toISOString(),
    };

    if (api_key === null) {
      // Explicitly removing key
      updateData.api_key_encrypted = null;
      updateData.api_key_masked = null;
    } else if (api_key && typeof api_key === 'string' && api_key.trim()) {
      const trimmedKey = api_key.trim();

      // Validate key by calling Gemini
      try {
        const testResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${trimmedKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Say "ok"' }] }],
              generationConfig: { maxOutputTokens: 5 },
            }),
          }
        );

        if (!testResponse.ok) {
          const errBody = await testResponse.json().catch(() => ({}));
          return NextResponse.json(
            { error: `Invalid API key: ${errBody?.error?.message || 'validation failed'}` },
            { status: 400 }
          );
        }
      } catch (err) {
        return NextResponse.json(
          { error: 'Could not validate API key. Check your network and try again.' },
          { status: 400 }
        );
      }

      updateData.api_key_encrypted = encrypt(trimmedKey);
      updateData.api_key_masked = maskApiKey(trimmedKey);
    }

    const { error } = await supabase
      .from('user_settings')
      .upsert(updateData, { onConflict: 'user_id' });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      masked_key: updateData.api_key_masked ?? undefined,
      model_preference: updateData.model_preference,
    });
  } catch (err: any) {
    console.error('Settings error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
