/**
 * AI Provider Abstraction Layer
 *
 * Routes LLM calls to either Google Gemini or Anthropic Claude based on
 * user preferences stored in user_settings. Both providers share the same
 * interface: accept a prompt string + generation config, return text.
 */

import { decrypt } from '@/lib/encryption';
import { AI_PROVIDERS, type AIProvider } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateTextOptions {
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  modelId: string;
}

interface UserSettingsRow {
  api_key_encrypted: string | null;
  anthropic_key_encrypted: string | null;
  ai_provider: AIProvider | null;
  model_preference: string | null;
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

async function callGemini(
  config: AIProviderConfig,
  options: GenerateTextOptions,
): Promise<string | null> {
  const response = await fetch(
    `${GEMINI_API_BASE}/${config.modelId}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: options.prompt }] }],
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens ?? 1024,
          temperature: options.temperature ?? 0.1,
        },
      }),
    },
  );

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error(`Gemini API error (${response.status}):`, errBody);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function callAnthropic(
  config: AIProviderConfig,
  options: GenerateTextOptions,
): Promise<string | null> {
  const response = await fetch(ANTHROPIC_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: options.maxOutputTokens ?? 1024,
      temperature: options.temperature ?? 0.1,
      messages: [{ role: 'user', content: options.prompt }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error(`Anthropic API error (${response.status}):`, errBody);
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  // Anthropic messages API returns content as an array of content blocks
  const textBlock = data.content?.find(
    (block: { type: string; text?: string }) => block.type === 'text',
  );
  return textBlock?.text || null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate text using the configured AI provider.
 * Throws on HTTP errors; returns null if the model produced no output.
 */
export async function generateText(
  config: AIProviderConfig,
  options: GenerateTextOptions,
): Promise<string | null> {
  switch (config.provider) {
    case 'gemini':
      return callGemini(config, options);
    case 'anthropic':
      return callAnthropic(config, options);
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

/**
 * Resolve an AIProviderConfig from a user_settings row.
 * Returns null if no usable API key is found for the selected provider.
 */
export function resolveProviderConfig(
  settings: UserSettingsRow,
): AIProviderConfig | null {
  const provider: AIProvider = settings.ai_provider || 'gemini';

  const defaultModel =
    AI_PROVIDERS.find((p) => p.id === provider)?.models[0]?.id ?? 'gemini-2.0-flash';

  if (provider === 'anthropic') {
    if (!settings.anthropic_key_encrypted) return null;
    try {
      const apiKey = decrypt(settings.anthropic_key_encrypted);
      return {
        provider,
        apiKey,
        modelId: settings.model_preference || defaultModel,
      };
    } catch {
      return null;
    }
  }

  // Default: Gemini
  if (!settings.api_key_encrypted) return null;
  try {
    const apiKey = decrypt(settings.api_key_encrypted);
    return {
      provider,
      apiKey,
      modelId: settings.model_preference || defaultModel,
    };
  } catch {
    return null;
  }
}

/**
 * Validate an API key by making a lightweight, non-generative request.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export async function validateApiKey(
  provider: AIProvider,
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (provider === 'anthropic') {
      // Use the models list endpoint (no generation cost)
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        return {
          valid: false,
          error: errBody?.error?.message || `Validation failed (${response.status})`,
        };
      }
      return { valid: true };
    }

    // Gemini: list models endpoint (free)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return {
        valid: false,
        error: errBody?.error?.message || 'Validation failed',
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      error: 'Could not validate API key. Check your network and try again.',
    };
  }
}
