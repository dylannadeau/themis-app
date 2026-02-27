'use client';

import { useState, useRef } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { GEMINI_MODELS } from '@/lib/types';
import {
  X, Key, FileText, Upload, Loader2, Save, Eye, EyeOff,
  AlertTriangle, CheckCircle, Cpu, Sparkles, AlertCircle
} from 'lucide-react';

interface NewUserSetupModalProps {
  onComplete: () => void;
}

export default function NewUserSetupModal({ onComplete }: NewUserSetupModalProps) {
  const [bioText, setBioText] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.0-flash');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDismissWarning, setShowDismissWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

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
      } else if (fileName.endsWith('.docx')) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ arrayBuffer });
          if (result.value && result.value.trim().length > 50) {
            setBioText(result.value.trim());
          } else {
            setError('Could not extract text from .docx file. Please paste your bio directly.');
          }
        } catch {
          setError('Failed to parse .docx file. Please paste your bio directly.');
        }
      } else {
        setError('Supported formats: .txt, .md, .docx');
      }
    } catch {
      setError('Failed to read file. Please paste your bio directly.');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session expired. Please sign in again.');
        return;
      }

      const body: Record<string, string | undefined> = {
        model_preference: model,
      };

      if (bioText.trim()) {
        body.bio_text = bioText.trim();
      }
      if (apiKey.trim()) {
        body.api_key = apiKey.trim();
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');

      onComplete();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = () => {
    if (!showDismissWarning) {
      setShowDismissWarning(true);
      return;
    }
    onComplete();
  };

  const hasAnyInput = bioText.trim().length > 0 || apiKey.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-themis-950/40 backdrop-blur-sm"
        onClick={() => !saving && handleDismiss()}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100/80 animate-slide-up overflow-hidden max-h-[90vh] flex flex-col">
        {/* Close button */}
        <button
          onClick={() => !saving && handleDismiss()}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition z-10"
          disabled={saving}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Scrollable content */}
        <div className="overflow-y-auto p-6 sm:p-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-themis-600 to-themis-800 flex items-center justify-center shadow-sm">
                <Sparkles className="w-4.5 h-4.5 text-white" />
              </div>
              <h2 className="font-display text-xl text-themis-900">Welcome to Themis</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Set up your profile to get personalized case discovery. This takes less than a minute.
            </p>
          </div>

          {/* Dismiss warning */}
          {showDismissWarning && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 mb-5 animate-slide-down">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Themis won&apos;t work as intended without this setup
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Without your bio and API key, AI-powered search, personalized rankings, and feedback analysis will be disabled.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => setShowDismissWarning(false)}
                    className="text-xs font-medium text-themis-600 hover:text-themis-800 transition"
                  >
                    Continue setup
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={onComplete}
                    className="text-xs font-medium text-gray-400 hover:text-gray-600 transition"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Professional Bio Section */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-bold text-themis-800 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Professional Bio
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.docx"
                onChange={handleFileUpload}
                className="hidden"
                id="setup-bio-upload"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                className="text-xs text-themis-500 hover:text-themis-700 font-medium flex items-center gap-1 transition"
              >
                {uploadingFile ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Upload className="w-3 h-3" />
                )}
                Upload file
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Your bio personalizes case rankings to your expertise and practice areas.
            </p>
            <textarea
              value={bioText}
              onChange={(e) => setBioText(e.target.value)}
              placeholder="Paste your professional bio here. Include your practice areas, expertise, notable cases, and background..."
              className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-themis-950
                         placeholder:text-gray-400 resize-vertical
                         focus:outline-none focus:ring-2 focus:ring-themis-500/20 focus:border-themis-400
                         transition-all duration-200"
              rows={4}
            />
          </div>

          {/* API Key Section */}
          <div className="mb-5">
            <label className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-1">
              <Key className="w-4 h-4" />
              Gemini API Key
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Your key is encrypted at rest and powers AI search and analysis. Get one free at{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-themis-500 hover:text-themis-700 underline"
              >
                aistudio.google.com
              </a>
            </p>
            <div className="relative">
              <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input-field pl-10 pr-10"
                placeholder="AIza..."
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
          <div className="mb-5">
            <label className="text-sm font-bold text-themis-800 flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4" />
              Model Preference
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Choose which Gemini model to use. You can change this later in Settings.
            </p>
            <div className="space-y-1.5">
              {GEMINI_MODELS.map((m) => (
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
                    name="setup-model"
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

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600 mb-4 animate-slide-down">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer - fixed at bottom */}
        <div className="border-t border-gray-100 px-6 sm:px-8 py-4 bg-gray-50/50 flex items-center justify-between gap-3">
          <button
            onClick={handleDismiss}
            disabled={saving}
            className="text-sm text-gray-400 hover:text-gray-600 transition"
          >
            Skip for now
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasAnyInput}
            className="btn-primary gap-2"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {saving ? 'Saving...' : 'Get Started'}
          </button>
        </div>
      </div>
    </div>
  );
}
