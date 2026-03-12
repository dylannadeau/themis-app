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
 * Tries the user's selected provider first, then falls back to the other
 * provider if the selected one has no key configured.
 * Returns null only if no usable API key is found for either provider.
 */
export function resolveProviderConfig(
  settings: UserSettingsRow,
): AIProviderConfig | null {
  const preferredProvider: AIProvider = settings.ai_provider || 'gemini';
  const fallbackProvider: AIProvider = preferredProvider === 'gemini' ? 'anthropic' : 'gemini';

  for (const provider of [preferredProvider, fallbackProvider]) {
    const providerDef = AI_PROVIDERS.find((p) => p.id === provider);
    const defaultModel = providerDef?.models[0]?.id ?? 'gemini-2.0-flash';
    const providerModelIds = new Set(providerDef?.models.map((m) => m.id) ?? []);

    const encryptedKey =
      provider === 'anthropic'
        ? settings.anthropic_key_encrypted
        : settings.api_key_encrypted;

    if (!encryptedKey) continue;

    try {
      const apiKey = decrypt(encryptedKey);
      // Use stored model_preference only if it belongs to this provider;
      // otherwise fall back to the provider's default model.
      const modelId =
        settings.model_preference && providerModelIds.has(settings.model_preference)
          ? settings.model_preference
          : defaultModel;
      return {
        provider,
        apiKey,
        modelId,
      };
    } catch (err) {
      console.error(`Failed to decrypt ${provider} API key:`, err);
      continue;
    }
  }

  return null;
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
