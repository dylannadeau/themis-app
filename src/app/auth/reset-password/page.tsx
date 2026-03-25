'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { Scale, ArrowRight, Loader2, Lock, Eye, EyeOff } from 'lucide-react';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Supabase automatically picks up the recovery tokens from the URL hash
    // and establishes a session. We listen for that event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    // Also check if session already exists (e.g. if page was refreshed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[45%] relative bg-gradient-to-br from-themis-900 via-themis-800 to-themis-950 p-12 flex-col justify-between overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
          backgroundSize: '32px 32px',
        }} />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-themis-600/10 rounded-full blur-3xl" />
        <div className="absolute top-20 -left-20 w-64 h-64 bg-themis-400/8 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center border border-white/10">
              <Scale className="w-5 h-5 text-white" />
            </div>
            <span className="font-display text-2xl text-white tracking-tight">Themis</span>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <h1 className="font-display text-4xl text-white leading-tight">
            Litigation Intelligence,<br />
            <span className="text-themis-300">Personalized.</span>
          </h1>
          <p className="text-themis-300/80 text-lg leading-relaxed max-w-md">
            Discover relevant cases with AI-powered search. Build your preference profile
            over time for results that get smarter the more you use them.
          </p>
        </div>

        <div className="relative z-10 text-themis-500 text-sm">
          &copy; {new Date().getFullYear()} Themis
        </div>
      </div>

      {/* Right panel — reset form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-10">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-themis-600 to-themis-800 flex items-center justify-center">
              <Scale className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="font-display text-xl text-themis-900">Themis</span>
          </div>

          <h2 className="font-display text-3xl text-themis-900 mb-2">Set a new password</h2>
          <p className="text-gray-500 mb-8">Enter your new password below.</p>

          {!sessionReady ? (
            <div className="flex items-center gap-3 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Verifying your reset link...</span>
            </div>
          ) : success ? (
            <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-700 animate-slide-down">
              Password updated successfully. Redirecting to dashboard...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-themis-800 mb-1.5">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pl-10 pr-10"
                    placeholder="At least 6 characters"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-themis-800 mb-1.5">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-field pl-10 pr-10"
                    placeholder="Confirm your new password"
                    minLength={6}
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600 animate-slide-down">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full gap-2">
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Update Password
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={() => router.push('/auth')}
              className="text-sm text-themis-500 hover:text-themis-700 transition"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
