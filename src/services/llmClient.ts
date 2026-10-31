import { env } from '../config/env.js';

/**
 * Minimal Anthropic Messages API client (fetch-based, no SDK dependency).
 * When no API key is configured `available` is false and callers fall back to
 * deterministic template generation — the workflow never blocks on the LLM.
 */
export const llm = {
  get available(): boolean {
    return Boolean(env.ANTHROPIC_API_KEY);
  },

  async complete(opts: {
    system: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string | null> {
    if (!this.available) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.2,
          system: opts.system,
          messages: [{ role: 'user', content: opts.prompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn(`[llm] Anthropic API returned ${res.status}; using template fallback`);
        return null;
      }

      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();
      return text || null;
    } catch (err) {
      console.warn(`[llm] call failed (${(err as Error).message}); using template fallback`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  },
};
