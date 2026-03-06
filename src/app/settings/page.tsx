'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AppShell from '@/components/AppShell';
import { AI_PROVIDERS, type AIProvider } from '@/lib/types';
import {
  Settings as SettingsIcon, Key, Cpu, Save, Loader2, CheckCircle,
  AlertCircle, Eye, EyeOff, Trash2, User, FileText, Upload, Pencil
} from 'lucide-react';

export default function SettingsPage() {
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicMaskedKey, setAnthropicMaskedKey] = useState<string | null>(null);
  const [model, setModel] = useState('gemini-2.0-flash');
  const [bioText, setBioText] = useState('');
  const [savedBio, setSavedBio] = useState<string | null>(null);
  const [bioEditing, setBioEditing] = useState(false);
  const [bioSaving, setBioSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bioTextareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const supabase = createClient();

  const activeProvider = AI_PROVIDERS.find((p) => p.id === provider) || AI_PROVIDERS[0];
  const activeKeyMask = provider === 'gemini' ? maskedKey : anthropicMaskedKey;

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
        const savedProvider: AIProvider = data.ai_provider || 'gemini';
        setProvider(savedProvider);
        setModel(data.model_preference || 'gemini-2.0-flash');
        if (data.api_key_encrypted) {
          setMaskedKey(data.api_key_masked || '****...****');
        }
        if (data.anthropic_key_encrypted) {
          setAnthropicMaskedKey(data.anthropic_key_masked || '****...****');
        }
        if (data.bio_text) {
          setBioText(data.bio_text);
          setSavedBio(data.bio_text);
          setBioEditing(false);
        } else {
          setBioEditing(true);
        }
      } else {
        setBioEditing(true);
      }
    }
    loadSettings();
  }, [supabase, router]);

  // When switching providers, pick the first model of the new provider if current model doesn't belong
  const handleProviderChange = (newProvider: AIProvider) => {
    setProvider(newProvider);
    const newProviderDef = AI_PROVIDERS.find((p) => p.id === newProvider);
    if (newProviderDef) {
      const currentModelBelongs = newProviderDef.models.some((m) => m.id === model);
      if (!currentModelBelongs) {
        setModel(newProviderDef.models[0].id);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    setError(null);

    try {
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
        const text = await file.text();
        setBioText(text);
        setBioEditing(true);
      } else if (fileName.endsWith('.docx')) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ arrayBuffer });
          if (result.value && result.value.trim().length > 50) {
            setBioText(result.value.trim());
            setBioEditing(true);
          } else {
            setError('Could not extract text from .docx file. Please copy and paste your bio text directly.');
          }
        } catch {
          setError('Failed to parse .docx file. Please copy and paste your bio text directly.');
        }
      } else {
        setError('Supported formats: .txt, .md, .docx');
      }
    } catch (err) {
      setError('Failed to read file. Please try pasting your bio text directly.');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleBioSave = async () => {
    if (!bioText.trim()) return;

    setBioSaving(true);
    setError(null);

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
          bio_text: bioText.trim(),
          model_preference: model,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save bio');

      setSavedBio(bioText.trim());
      setBioEditing(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBioSaving(false);
    }
  };

  const handleBioEdit = () => {
    setBioEditing(true);
    setTimeout(() => bioTextareaRef.current?.focus(), 50);
  };

  const handleBioCancelEdit = () => {
    if (savedBio) {
      setBioText(savedBio);
      setBioEditing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const body: Record<string, any> = {
        ai_provider: provider,
        model_preference: model,
      };

      // Send the key for whichever provider the user entered
      if (apiKey) body.api_key = apiKey;
      if (anthropicKey) body.anthropic_key = anthropicKey;

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save');

      setSuccess('Settings saved successfully.');
      if (apiKey) {
        setMaskedKey(data.masked_key || '****...****');
        setApiKey('');
      }
      if (anthropicKey) {
        setAnthropicMaskedKey(data.anthropic_masked_key || '****...****');
        setAnthropicKey('');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async (keyProvider: AIProvider) => {
    const providerName = keyProvider === 'gemini' ? 'Gemini' : 'Anthropic';
    if (!confirm(`Are you sure you want to remove your ${providerName} API key? AI features using this provider will be disabled.`)) return;

    setDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const body: Record<string, any> = { model_preference: model };
      if (keyProvider === 'gemini') {
        body.api_key = null;
      } else {
        body.anthropic_key = null;
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete key');
      }

      if (keyProvider === 'gemini') {
        setMaskedKey(null);
        setApiKey('');
      } else {
        setAnthropicMaskedKey(null);
        setAnthropicKey('');
      }
      setSuccess(`${providerName} API key removed.`);
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

        {/* Professional Bio */}
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-themis-800 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Professional Bio
            </h2>
            {savedBio && !bioEditing && (
              <button
                onClick={handleBioEdit}
                className="btn-ghost text-xs text-themis-500 gap-1.5"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Your bio is used to personalize case rankings based on your expertise and practice areas.
          </p>

          {bioEditing ? (
            <>
              {/* File upload */}
              <div className="mb-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="bio-file-upload"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="btn-secondary text-xs gap-2"
                >
                  {uploadingFile ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Upload className="w-3 h-3" />
                  )}
                  Upload .txt or .docx
                </button>
              </div>

              {/* Bio text area */}
              <textarea
                ref={bioTextareaRef}
                value={bioText}
                onChange={(e) => setBioText(e.target.value)}
                placeholder="Paste your professional bio here. Include your practice areas, expertise, notable cases, and background..."
                className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-themis-950
                           placeholder:text-gray-400 resize-vertical
                           focus:outline-none focus:ring-2 focus:ring-themis-500/20 focus:border-themis-400
                           transition-all duration-200"
                rows={6}
              />

              {/* Save / Cancel buttons */}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleBioSave}
                  disabled={bioSaving || !bioText.trim()}
                  className="btn-primary text-xs py-2 px-4 gap-2"
                >
                  {bioSaving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  Save Bio
                </button>
                {savedBio && (
                  <button
                    onClick={handleBioCancelEdit}
                    className="btn-ghost text-xs text-gray-500"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          ) : (
            /* Saved / locked state */
            <div className="relative">
              <div className="w-full px-4 py-3 rounded-lg border border-gray-100 bg-gray-50 text-sm text-gray-500 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {savedBio}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-600">
                <CheckCircle className="w-3 h-3" />
                Bio saved
              </div>
            </div>
          )}
        </div>

        {/* AI Configuration */}
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4" />
            AI Configuration
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Choose your AI provider, API key, and model for search synthesis, feedback analysis, and case scoring.
          </p>

          {/* Provider toggle */}
          <div className="flex gap-2 mb-4">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProviderChange(p.id)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  provider === p.id
                    ? 'bg-themis-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* API Key for selected provider */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5" />
                {activeProvider.name} API Key
              </label>
              <a
                href={activeProvider.keyHelpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-themis-500 hover:text-themis-700 underline"
              >
                {activeProvider.keyHelpLabel}
              </a>
            </div>

            {activeKeyMask && (
              <div className="flex items-center justify-between px-3 py-2 bg-emerald-50/50 border border-emerald-100 rounded-lg mb-2">
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-xs text-emerald-700">
                    Configured: <span className="font-mono">{activeKeyMask}</span>
                  </span>
                </div>
                <button
                  onClick={() => handleDeleteKey(provider)}
                  disabled={deleting}
                  className="text-red-400 hover:text-red-600 transition p-0.5"
                  title={`Remove ${activeProvider.name} API key`}
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}

            <div className="relative">
              <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              {provider === 'gemini' ? (
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="input-field pl-10 pr-10"
                  placeholder={maskedKey ? 'Enter new key to replace' : activeProvider.keyPlaceholder}
                />
              ) : (
                <input
                  type={showAnthropicKey ? 'text' : 'password'}
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  className="input-field pl-10 pr-10"
                  placeholder={anthropicMaskedKey ? 'Enter new key to replace' : activeProvider.keyPlaceholder}
                />
              )}
              <button
                type="button"
                onClick={() => provider === 'gemini' ? setShowKey(!showKey) : setShowAnthropicKey(!showAnthropicKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              >
                {(provider === 'gemini' ? showKey : showAnthropicKey)
                  ? <EyeOff className="w-4 h-4" />
                  : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model selection for selected provider */}
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1.5 block">Model</label>
            <div className="space-y-1.5">
              {activeProvider.models.map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
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

        {/* Save Button (for provider + API keys + model) */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary gap-2 w-full sm:w-auto"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save AI Settings
        </button>
      </div>
    </AppShell>
  );
}
