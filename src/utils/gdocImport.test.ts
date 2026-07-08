import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchGDocInfo } from './gdocImport';

describe('fetchGDocInfo', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GDOC_WEBAPP_DEPLOYMENT_ID', 'DEPLOY123');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ tabTitle: 'T', tabId: 't.0', textLength: 0, text: '', bookmarks: [], tabs: [] }),
    })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('omits suggestions param by default', async () => {
    await fetchGDocInfo('DOC1');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('docId=DOC1');
    expect(url).not.toContain('suggestions=');
  });

  it('passes suggestions=accepted when requested', async () => {
    await fetchGDocInfo('DOC1', null, 'accepted');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('suggestions=accepted');
  });

  it('passes suggestions=base explicitly when given', async () => {
    await fetchGDocInfo('DOC1', 'Tab 1', 'base');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('suggestions=base');
    expect(url).toContain('tab=Tab+1');
  });
});
