import { describe, it, expect } from 'vitest';
import { buildPanel } from './index';

const FULL_ENV = {
  ANTHROPIC_API_KEY: 'anthropic-key',
  OPENAI_API_KEY: 'openai-key',
  GEMINI_API_KEY: 'gemini-key',
  PANEL_OPENAI_MODEL: 'gpt-5',
  PANEL_GEMINI_MODEL: 'gemini-2.5-pro',
} as unknown as NodeJS.ProcessEnv;

describe('buildPanel', () => {
  it('builds a 3-judge panel when all env vars are present', () => {
    const judges = buildPanel(FULL_ENV, []);
    expect(judges).toHaveLength(3);
    expect(judges.map((j) => j.lab).sort()).toEqual(['anthropic', 'google', 'openai']);
  });

  it('throws naming PANEL_OPENAI_MODEL when it is missing', () => {
    const { PANEL_OPENAI_MODEL, ...env } = FULL_ENV as Record<string, string>;
    expect(() => buildPanel(env as unknown as NodeJS.ProcessEnv, [])).toThrow(/PANEL_OPENAI_MODEL/);
  });

  it('throws naming PANEL_GEMINI_MODEL when it is missing', () => {
    const { PANEL_GEMINI_MODEL, ...env } = FULL_ENV as Record<string, string>;
    expect(() => buildPanel(env as unknown as NodeJS.ProcessEnv, [])).toThrow(/PANEL_GEMINI_MODEL/);
  });

  it('throws naming OPENAI_API_KEY when PANEL_OPENAI_MODEL is set but the key is missing', () => {
    const { OPENAI_API_KEY, ...env } = FULL_ENV as Record<string, string>;
    expect(() => buildPanel(env as unknown as NodeJS.ProcessEnv, [])).toThrow(/OPENAI_API_KEY/);
  });

  it('throws naming GEMINI_API_KEY when PANEL_GEMINI_MODEL is set but the key is missing', () => {
    const { GEMINI_API_KEY, ...env } = FULL_ENV as Record<string, string>;
    expect(() => buildPanel(env as unknown as NodeJS.ProcessEnv, [])).toThrow(/GEMINI_API_KEY/);
  });

  it('throws naming ANTHROPIC_API_KEY when it is missing', () => {
    const { ANTHROPIC_API_KEY, ...env } = FULL_ENV as Record<string, string>;
    expect(() => buildPanel(env as unknown as NodeJS.ProcessEnv, [])).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('does not silently return a 1- or 2-judge panel by default', () => {
    const anthropicOnly = { ANTHROPIC_API_KEY: 'anthropic-key' } as unknown as NodeJS.ProcessEnv;
    expect(() => buildPanel(anthropicOnly, [])).toThrow();
  });

  it('allowPartial permits omitting seats whose vars are missing', () => {
    const anthropicOnly = { ANTHROPIC_API_KEY: 'anthropic-key' } as unknown as NodeJS.ProcessEnv;
    const judges = buildPanel(anthropicOnly, [], { allowPartial: true });
    expect(judges).toHaveLength(1);
    expect(judges[0].lab).toBe('anthropic');
  });

  it('allowPartial still builds all 3 seats when every var is present', () => {
    const judges = buildPanel(FULL_ENV, [], { allowPartial: true });
    expect(judges).toHaveLength(3);
  });
});
