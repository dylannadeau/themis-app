'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import { GEMINI_MODELS } from '@/lib/types';
import {
  Settings as SettingsIcon, Key, Cpu, Save, Loader2, CheckCircle,
  AlertCircle, Eye, EyeOff, Trash2, User
} from 'lucide-react';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [model, setModel] = useState('gemini-2.0-flash');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function loadSettings() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/auth'); return; }

      setUserEmail(session.user.email || '');

      const { data } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (data) {
        setModel(data.model_preference || 'gemini-2.0-flash');
        if (data.api_key_encrypted) {
          // Show masked version
          setMaskedKey(data.api_key_masked || '****...****');
        }
      }
    }
    loadSettings();
  }, [supabase, router]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          api_key: apiKey || undefined,
          model_preference: model,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save');

      setSuccess('Settings saved successfully.');
      if (apiKey) {
        setMaskedKey(data.masked_key || '****...****');
        setApiKey('');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!confirm('Are you sure you want to remove your API key? AI search will be disabled.')) return;

    setDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ api_key: null, model_preference: model }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete key');
      }

      setMaskedKey(null);
      setApiKey('');
      setSuccess('API key removed.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell>
      <div className="page-container max-w-2xl">
        <h1 className="section-title flex items-center gap-3 mb-8">
          <SettingsIcon className="w-6 h-6 text-themis-500" />
          Settings
        </h1>

        {/* Account Info */}
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-4">
            <User className="w-4 h-4" />
            Account
          </h2>
          <div className="text-sm text-gray-600">
            Signed in as <span className="font-medium text-themis-900">{userEmail}</span>
          </div>
        </div>

        {/* API Key Configuration */}
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-1">
            <Key className="w-4 h-4" />
            Gemini API Key
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            Your key is encrypted at rest and only used during search requests. Get one free at{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-themis-500 hover:text-themis-700 underline"
            >
              aistudio.google.com
            </a>
          </p>

          {/* Current key status */}
          {maskedKey && (
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-50/50 border border-emerald-100 rounded-lg mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-sm text-emerald-700">
                  Key configured: <span className="font-mono">{maskedKey}</span>
                </span>
              </div>
              <button
                onClick={handleDeleteKey}
                disabled={deleting}
                className="text-red-400 hover:text-red-600 transition p-1"
                title="Remove API key"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Key input */}
          <div className="relative">
            <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="input-field pl-10 pr-10"
              placeholder={maskedKey ? 'Enter new key to replace' : 'AIza...'}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Model Selection */}
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4" />
            Model Preference
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Choose which Gemini model to use for search synthesis. Cost varies by model.
          </p>

          <div className="space-y-2">
            {GEMINI_MODELS.map((m) => (
              <label
                key={m.id}
                className={`flex items-center gap-3 p-3.5 rounded-lg border cursor-pointer transition-all ${
                  model === m.id
                    ? 'border-themis-300 bg-themis-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50/50'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={model === m.id}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-4 h-4 text-themis-600 focus:ring-themis-500/30"
                />
                <div>
                  <span className="text-sm font-medium text-themis-900">{m.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{m.description}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600 mb-4 animate-slide-down">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-700 mb-4 animate-slide-down">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary gap-2 w-full sm:w-auto"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </button>
      </div>
    </AppShell>
  );
}
