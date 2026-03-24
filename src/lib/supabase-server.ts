import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export function createServerSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Can fail in Server Components — that's OK
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (error) {
            // Can fail in Server Components — that's OK
          }
        },
      },
    }
  );
}

/**
 * Authenticate the request and return the Supabase client + user.
 * Uses getUser() which validates the JWT server-side (not just from cookies).
 * Returns { supabase, session } on success, or a 401 NextResponse on failure.
 * Note: session.user is the server-validated user from getUser().
 */
export async function requireAuth() {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  // Build a session-like object so callers can use session.user.id as before
  return { supabase, session: { user } };
}
