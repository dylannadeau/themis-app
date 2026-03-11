import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateText, resolveProviderConfig, validateApiKey } from '../ai-provider';
import type { AIProviderConfig } from '../ai-provider';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock the decrypt function used by resolveProviderConfig
vi.mock('@/lib/encryption', () => ({
  decrypt: (encrypted: string) => {
    if (encrypted === 'bad-encrypted') throw new Error('Decryption failed');
    return `decrypted-${encrypted}`;
  },
}));

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// generateText — Gemini provider
// ---------------------------------------------------------------------------
describe('generateText — Gemini', () => {
  const geminiConfig: AIProviderConfig = {
    provider: 'gemini',
    apiKey: 'test-gemini-key',
    modelId: 'gemini-2.0-flash',
  };

  it('sends correct request structure to Gemini API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
      }),
    });

    const result = await generateText(geminiConfig, {
      prompt: 'Say hello',
      maxOutputTokens: 512,
      temperature: 0.3,
    });

    expect(result).toBe('Hello from Gemini');

    // Verify the URL includes model and key
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('gemini-2.0-flash:generateContent');
    expect(url).toContain('key=test-gemini-key');
    expect(options.method).toBe('POST');

    // Verify request body shape
    const body = JSON.parse(options.body);
    expect(body.contents[0].parts[0].text).toBe('Say hello');
    expect(body.generationConfig.maxOutputTokens).toBe(512);
    expect(body.generationConfig.temperature).toBe(0.3);
  });

  it('returns null when Gemini produces no output', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [] } }] }),
    });

    const result = await generateText(geminiConfig, { prompt: 'empty' });
    expect(result).toBeNull();
  });

  it('throws on Gemini HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limited' } }),
    });

    await expect(
      generateText(geminiConfig, { prompt: 'fail' }),
    ).rejects.toThrow('Gemini API error: 429');
  });

  it('uses default maxOutputTokens and temperature', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      }),
    });

    await generateText(geminiConfig, { prompt: 'defaults' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.generationConfig.maxOutputTokens).toBe(1024);
    expect(body.generationConfig.temperature).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// generateText — Anthropic provider
// ---------------------------------------------------------------------------
describe('generateText — Anthropic', () => {
  const anthropicConfig: AIProviderConfig = {
    provider: 'anthropic',
    apiKey: 'sk-ant-test-key',
    modelId: 'claude-sonnet-4-6',
  };

  it('sends correct request structure to Anthropic API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello from Claude' }],
      }),
    });

    const result = await generateText(anthropicConfig, {
      prompt: 'Say hello',
      maxOutputTokens: 256,
      temperature: 0.5,
    });

    expect(result).toBe('Hello from Claude');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('api.anthropic.com/v1/messages');
    expect(options.headers['x-api-key']).toBe('sk-ant-test-key');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.5);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toBe('Say hello');
  });

  it('returns null when Anthropic produces no text block', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [] }),
    });

    const result = await generateText(anthropicConfig, { prompt: 'empty' });
    expect(result).toBeNull();
  });

  it('throws on Anthropic HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    });

    await expect(
      generateText(anthropicConfig, { prompt: 'fail' }),
    ).rejects.toThrow('Anthropic API error: 401');
  });

  it('finds text block among multiple content blocks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: 'tool_use', id: 'abc' },
          { type: 'text', text: 'Found it' },
        ],
      }),
    });

    const result = await generateText(anthropicConfig, { prompt: 'multi' });
    expect(result).toBe('Found it');
  });
});

// ---------------------------------------------------------------------------
// generateText — unsupported provider
// ---------------------------------------------------------------------------
describe('generateText — unsupported provider', () => {
  it('throws for unknown provider', async () => {
    const badConfig = {
      provider: 'openai' as any,
      apiKey: 'key',
      modelId: 'gpt-4',
    };

    await expect(
      generateText(badConfig, { prompt: 'test' }),
    ).rejects.toThrow('Unsupported AI provider: openai');
  });
});

// ---------------------------------------------------------------------------
// resolveProviderConfig
// ---------------------------------------------------------------------------
describe('resolveProviderConfig', () => {
  it('resolves Gemini config when ai_provider is gemini', () => {
    const config = resolveProviderConfig({
      ai_provider: 'gemini',
      api_key_encrypted: 'enc-gemini-key',
      anthropic_key_encrypted: null,
      model_preference: 'gemini-2.5-pro',
    });

    expect(config).not.toBeNull();
    expect(config!.provider).toBe('gemini');
    expect(config!.apiKey).toBe('decrypted-enc-gemini-key');
    expect(config!.modelId).toBe('gemini-2.5-pro');
  });

  it('resolves Anthropic config when ai_provider is anthropic', () => {
    const config = resolveProviderConfig({
      ai_provider: 'anthropic',
      api_key_encrypted: null,
      anthropic_key_encrypted: 'enc-claude-key',
      model_preference: 'claude-sonnet-4-6',
    });

    expect(config).not.toBeNull();
    expect(config!.provider).toBe('anthropic');
    expect(config!.apiKey).toBe('decrypted-enc-claude-key');
    expect(config!.modelId).toBe('claude-sonnet-4-6');
  });

  it('defaults to gemini when ai_provider is null', () => {
    const config = resolveProviderConfig({
      ai_provider: null,
      api_key_encrypted: 'enc-key',
      anthropic_key_encrypted: null,
      model_preference: null,
    });

    expect(config).not.toBeNull();
    expect(config!.provider).toBe('gemini');
    expect(config!.modelId).toBe('gemini-2.0-flash'); // default model
  });

  it('falls back to anthropic when gemini selected but no gemini key', () => {
    const config = resolveProviderConfig({
      ai_provider: 'gemini',
      api_key_encrypted: null,
      anthropic_key_encrypted: 'enc-claude',
      model_preference: null,
    });

    expect(config).not.toBeNull();
    expect(config!.provider).toBe('anthropic');
    expect(config!.apiKey).toBe('decrypted-enc-claude');
  });

  it('falls back to gemini when anthropic selected but no anthropic key', () => {
    const config = resolveProviderConfig({
      ai_provider: 'anthropic',
      api_key_encrypted: 'enc-gemini',
      anthropic_key_encrypted: null,
      model_preference: null,
    });

    expect(config).not.toBeNull();
    expect(config!.provider).toBe('gemini');
    expect(config!.apiKey).toBe('decrypted-enc-gemini');
  });

  it('returns null when no keys are configured', () => {
    const config = resolveProviderConfig({
      ai_provider: 'gemini',
      api_key_encrypted: null,
      anthropic_key_encrypted: null,
      model_preference: null,
    });

    expect(config).toBeNull();
  });

  it('falls back to other provider when decryption fails', () => {
    const config = resolveProviderConfig({
      ai_provider: 'gemini',
      api_key_encrypted: 'bad-encrypted',
      anthropic_key_encrypted: 'enc-claude',
      model_preference: null,
    });

    expect(config).not.toBeNull();
    expect(config!.provider).toBe('anthropic');
  });

  it('returns null when decryption fails and no fallback key', () => {
    const config = resolveProviderConfig({
      ai_provider: 'gemini',
      api_key_encrypted: 'bad-encrypted',
      anthropic_key_encrypted: null,
      model_preference: null,
    });

    expect(config).toBeNull();
  });

  it('uses default model for anthropic when model_preference is null', () => {
    const config = resolveProviderConfig({
      ai_provider: 'anthropic',
      api_key_encrypted: null,
      anthropic_key_encrypted: 'enc-key',
      model_preference: null,
    });

    expect(config).not.toBeNull();
    expect(config!.modelId).toBe('claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// validateApiKey
// ---------------------------------------------------------------------------
describe('validateApiKey', () => {
  it('validates a Gemini key via models list endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await validateApiKey('gemini', 'AIzaTestKey');

    expect(result).toEqual({ valid: true });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('key=AIzaTestKey');
  });

  it('validates an Anthropic key via models endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await validateApiKey('anthropic', 'sk-ant-test');

    expect(result).toEqual({ valid: true });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('api.anthropic.com/v1/models');
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-api-key']).toBe('sk-ant-test');
  });

  it('returns error for invalid Gemini key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'API key not valid' } }),
    });

    const result = await validateApiKey('gemini', 'bad-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('API key not valid');
  });

  it('returns error for invalid Anthropic key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'Invalid x-api-key' } }),
    });

    const result = await validateApiKey('anthropic', 'bad-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid x-api-key');
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await validateApiKey('gemini', 'any-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('network');
  });

  it('handles JSON parse failure on error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    });

    const result = await validateApiKey('gemini', 'any-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Validation failed');
  });
});

// ---------------------------------------------------------------------------
// Types consistency tests
// ---------------------------------------------------------------------------
describe('AI_PROVIDERS type consistency', () => {
  it('exports AIProvider type that matches provider ids', async () => {
    const { AI_PROVIDERS } = await import('../types');

    expect(AI_PROVIDERS).toHaveLength(2);
    expect(AI_PROVIDERS[0].id).toBe('gemini');
    expect(AI_PROVIDERS[1].id).toBe('anthropic');
  });

  it('each provider has at least one model', async () => {
    const { AI_PROVIDERS } = await import('../types');

    for (const provider of AI_PROVIDERS) {
      expect(provider.models.length).toBeGreaterThan(0);
      for (const model of provider.models) {
        expect(model.id).toBeTruthy();
        expect(model.name).toBeTruthy();
      }
    }
  });

  it('each provider has key help info', async () => {
    const { AI_PROVIDERS } = await import('../types');

    for (const provider of AI_PROVIDERS) {
      expect(provider.keyPlaceholder).toBeTruthy();
      expect(provider.keyHelpUrl).toMatch(/^https?:\/\//);
      expect(provider.keyHelpLabel).toBeTruthy();
    }
  });

  it('GEMINI_MODELS is still exported for backward compatibility', async () => {
    const { GEMINI_MODELS } = await import('../types');

    expect(GEMINI_MODELS.length).toBeGreaterThan(0);
    expect(GEMINI_MODELS[0].id).toBe('gemini-2.0-flash');
  });
});
