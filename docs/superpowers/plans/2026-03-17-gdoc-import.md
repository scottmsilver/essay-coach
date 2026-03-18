# Google Docs Import Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow students to import essay text and assignment prompts from Google Docs by selecting a tab and section (defined by bookmarks), with text re-fetched from Google Docs on each analysis or resubmission.

**Architecture:** An already-deployed Apps Script web app reads Google Docs and returns text + bookmark positions as JSON. The client calls it during import to show a step-by-step picker (URL → tab → section). Doc references are stored in Firestore; the backend re-fetches fresh text from the web app at evaluation time.

**Tech Stack:** React + Mantine (frontend), Firebase Cloud Functions (backend), Google Apps Script web app (already deployed), Vite env vars for config.

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `shared/gdocTypes.ts` | `DocSource` type + `parseSections()` pure function (used by frontend + backend) |
| `src/utils/gdocImport.ts` | Client-side: parse doc URL, call web app, return structured data |
| `src/components/GDocImportDialog.tsx` | Multi-step modal: URL → tab → section picker |
| `functions/src/gdocResolver.ts` | Server-side: resolve `DocSource` → text string by calling web app |
| `functions/tests/gdocResolver.test.ts` | Tests for server-side resolver |

### Modified files
| File | Change |
|------|--------|
| `src/types.ts` | Import + re-export `DocSource` from shared |
| `.env.local` | Add `VITE_GDOC_WEBAPP_DEPLOYMENT_ID` |
| `src/pages/NewEssayPage.tsx` | Add "Import from Google Docs" buttons for prompt and essay fields |
| `src/pages/RevisionPage.tsx` | Show read-only state for doc-sourced essays; re-fetch on resubmit |
| `functions/src/evaluateEssay.ts` | Resolve doc sources before evaluation |
| `functions/src/validation.ts` | Allow empty content/prompt when doc source is provided |

---

## Chunk 1: Shared Types + Section Parsing

### Task 1: DocSource type and parseSections utility

**Files:**
- Create: `shared/gdocTypes.ts`
- Modify: `src/types.ts`
- Create: `functions/tests/gdocTypes.test.ts`

- [ ] **Step 1: Write tests for parseSections**

Create `functions/tests/gdocTypes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseSections } from '../../shared/gdocTypes';

describe('parseSections', () => {
  it('returns entire text as one section when no bookmarks', () => {
    const sections = parseSections('Hello world', []);
    expect(sections).toEqual(['Hello world']);
  });

  it('splits text at bookmark offsets', () => {
    const text = 'AAABBBCCC';
    const bookmarks = [
      { id: 'bm1', offset: 3 },
      { id: 'bm2', offset: 6 },
    ];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('handles bookmark at start of text', () => {
    const text = 'AAABBB';
    const bookmarks = [{ id: 'bm1', offset: 0 }, { id: 'bm2', offset: 3 }];
    const sections = parseSections(text, bookmarks);
    // Section from 0..0 is empty (filtered), 0..3, 3..end
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('handles bookmark at end of text', () => {
    const text = 'AAABBB';
    const bookmarks = [{ id: 'bm1', offset: 3 }, { id: 'bm2', offset: 6 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('filters out empty sections', () => {
    const text = 'AAABBB';
    // Two bookmarks at same offset
    const bookmarks = [{ id: 'bm1', offset: 3 }, { id: 'bm2', offset: 3 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('trims whitespace from sections', () => {
    const text = '  AAA  \n\n  BBB  ';
    const bookmarks = [{ id: 'bm1', offset: 7 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('handles single bookmark splitting into two sections', () => {
    const text = 'Prompt text here\nEssay text here';
    const bookmarks = [{ id: 'bm1', offset: 17 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['Prompt text here', 'Essay text here']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run tests/gdocTypes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create shared/gdocTypes.ts**

Create `shared/gdocTypes.ts`:

```typescript
/** Reference to a section within a Google Doc tab */
export interface DocSource {
  docId: string;
  tab: string;
  sectionIndex: number;
}

/** Bookmark position as returned by the Apps Script web app */
export interface GDocBookmark {
  id: string;
  offset: number;
}

/** Response from the Apps Script web app */
export interface GDocWebAppResponse {
  tabTitle: string;
  tabId: string;
  textLength: number;
  text: string;
  bookmarks: GDocBookmark[];
  tabs: Array<{ title: string; id: string }>;
  error?: string;
}

/**
 * Split tab text into sections using bookmark offsets as dividers.
 * - 0 bookmarks → 1 section (entire text)
 * - N bookmarks → up to N+1 sections
 * Empty sections are filtered out. Sections are trimmed.
 */
export function parseSections(
  text: string,
  bookmarks: GDocBookmark[],
): string[] {
  if (bookmarks.length === 0) return [text.trim()].filter(s => s.length > 0);

  const offsets = [0, ...bookmarks.map(b => b.offset), text.length];
  const unique = [...new Set(offsets)].sort((a, b) => a - b);

  return unique
    .slice(0, -1)
    .map((start, i) => text.substring(start, unique[i + 1]).trim())
    .filter(s => s.length > 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run tests/gdocTypes.test.ts`
Expected: PASS

- [ ] **Step 5: Add DocSource to frontend types**

Modify `src/types.ts` — add at the top, after the existing shared imports:

```typescript
import type { DocSource } from '../shared/gdocTypes';
export type { DocSource };
```

Extend the Essay interface by adding two optional fields after `currentDraftNumber`:

```typescript
export interface Essay {
  // ... existing fields ...
  currentDraftNumber: number;
  promptSource?: DocSource | null;
  contentSource?: DocSource | null;
}
```

- [ ] **Step 6: Verify frontend builds**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add shared/gdocTypes.ts src/types.ts functions/tests/gdocTypes.test.ts
git commit -m "feat: add DocSource type and parseSections utility for Google Docs import"
```

---

### Task 2: Environment configuration

**Files:**
- Modify: `.env.local`

- [ ] **Step 1: Add web app deployment ID to .env.local**

Append to `.env.local`:

```
VITE_GDOC_WEBAPP_DEPLOYMENT_ID=AKfycbwNu3jyPAQjR0IBZXKzEj_ueHdOlDR7bsznfwMPml6hFgF2nNAlIMBb3mUM8_I6L29RQg
```

- [ ] **Step 2: Verify Vite sees the env var**

Run: `cd /home/ssilver/development/essay-grader && grep VITE_GDOC .env.local`
Expected: Shows the deployment ID line

- [ ] **Step 3: Commit**

```bash
git add .env.local
git commit -m "config: add Google Docs web app deployment ID"
```

---

## Chunk 2: Client-Side Import Utilities

### Task 3: Client-side gdocImport utility

**Files:**
- Create: `src/utils/gdocImport.ts`

- [ ] **Step 1: Create gdocImport.ts**

Create `src/utils/gdocImport.ts`:

```typescript
import type { GDocWebAppResponse } from '../../shared/gdocTypes';

const WEBAPP_BASE = 'https://script.google.com/macros/s';

function getDeploymentId(): string {
  const id = import.meta.env.VITE_GDOC_WEBAPP_DEPLOYMENT_ID;
  if (!id) throw new Error('VITE_GDOC_WEBAPP_DEPLOYMENT_ID not configured');
  return id;
}

/** Extract doc ID from a Google Docs URL or return as-is if already an ID */
export function extractDocId(input: string): string {
  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  } catch {
    // Not a URL — treat as raw ID
  }
  return input;
}

/** Extract tab hint from URL hash (e.g., ?tab=t.0) */
export function extractTabHint(input: string): string | null {
  try {
    const url = new URL(input);
    return url.searchParams.get('tab');
  } catch {
    return null;
  }
}

/** Fetch doc info from Apps Script web app */
export async function fetchGDocInfo(
  docId: string,
  tab?: string | null,
): Promise<GDocWebAppResponse> {
  const deploymentId = getDeploymentId();
  const params = new URLSearchParams({ docId });
  if (tab) params.set('tab', tab);
  const url = `${WEBAPP_BASE}/${deploymentId}/exec?${params}`;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to fetch document (${res.status})`);
  }
  const data: GDocWebAppResponse = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/gdocImport.ts
git commit -m "feat: add client-side Google Docs import utility"
```

---

### Task 4: GDocImportDialog component

**Files:**
- Create: `src/components/GDocImportDialog.tsx`

- [ ] **Step 1: Create the import dialog component**

Create `src/components/GDocImportDialog.tsx`:

```tsx
import { useState } from 'react';
import { Modal, TextInput, Button, Radio, Stack, Text, Loader, Alert } from '@mantine/core';
import { extractDocId, fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
import type { DocSource, GDocWebAppResponse } from '../../shared/gdocTypes';

interface Props {
  opened: boolean;
  onClose: () => void;
  onImport: (text: string, source: DocSource) => void;
  label: string; // "essay" or "prompt"
}

type Step = 'url' | 'tab' | 'section';

export default function GDocImportDialog({ opened, onClose, onImport, label }: Props) {
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data from web app
  const [docId, setDocId] = useState('');
  const [tabs, setTabs] = useState<Array<{ title: string; id: string }>>([]);
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [docData, setDocData] = useState<GDocWebAppResponse | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [selectedSection, setSelectedSection] = useState<number>(0);

  const reset = () => {
    setStep('url');
    setUrl('');
    setLoading(false);
    setError(null);
    setDocId('');
    setTabs([]);
    setSelectedTab(null);
    setDocData(null);
    setSections([]);
    setSelectedSection(0);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFetchTabs = async () => {
    setError(null);
    setLoading(true);
    try {
      const id = extractDocId(url);
      setDocId(id);
      const data = await fetchGDocInfo(id);
      setTabs(data.tabs);
      if (data.tabs.length === 1) {
        // Auto-select single tab and move to section step
        setSelectedTab(data.tabs[0].title);
        await handleFetchSections(id, data.tabs[0].title);
      } else {
        setStep('tab');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch document');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchSections = async (id: string, tab: string) => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchGDocInfo(id, tab);
      setDocData(data);
      const parsed = parseSections(data.text, data.bookmarks);
      setSections(parsed);
      setSelectedSection(0);
      setStep('section');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tab');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTab = async (tab: string) => {
    setSelectedTab(tab);
    await handleFetchSections(docId, tab);
  };

  const handleConfirm = () => {
    if (!selectedTab || sections.length === 0) return;
    const source: DocSource = {
      docId,
      tab: selectedTab,
      sectionIndex: selectedSection,
    };
    onImport(sections[selectedSection], source);
    handleClose();
  };

  const preview = (text: string, maxLen = 150) => {
    const clean = text.replace(/\n+/g, ' ').trim();
    return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={`Import ${label} from Google Docs`} size="lg">
      {error && <Alert color="red" mb="md">{error}</Alert>}

      {step === 'url' && (
        <Stack>
          <TextInput
            label="Google Docs URL"
            placeholder="https://docs.google.com/document/d/..."
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            disabled={loading}
          />
          <Button onClick={handleFetchTabs} disabled={!url.trim() || loading} loading={loading}>
            Fetch Document
          </Button>
        </Stack>
      )}

      {step === 'tab' && (
        <Stack>
          <Text fw={500}>Select a tab:</Text>
          <Radio.Group value={selectedTab ?? ''} onChange={(val) => handleSelectTab(val)}>
            <Stack gap="xs">
              {tabs.map((t) => (
                <Radio key={t.id} value={t.title} label={t.title} disabled={loading} />
              ))}
            </Stack>
          </Radio.Group>
          {loading && <Loader size="sm" />}
          <Button variant="subtle" onClick={() => { setStep('url'); setError(null); }}>
            Back
          </Button>
        </Stack>
      )}

      {step === 'section' && (
        <Stack>
          <Text fw={500}>
            Tab: "{selectedTab}" — {sections.length === 1 ? '1 section (no bookmarks)' : `${sections.length} sections`}
          </Text>
          <Radio.Group
            value={String(selectedSection)}
            onChange={(val) => setSelectedSection(Number(val))}
          >
            <Stack gap="xs">
              {sections.map((s, i) => (
                <Radio
                  key={i}
                  value={String(i)}
                  label={
                    <Text size="sm">
                      <Text span fw={500}>Section {i + 1}: </Text>
                      {preview(s)}
                    </Text>
                  }
                />
              ))}
            </Stack>
          </Radio.Group>
          <Button onClick={handleConfirm}>
            Import Section {selectedSection + 1} as {label}
          </Button>
          <Button variant="subtle" onClick={() => {
            if (tabs.length > 1) {
              setStep('tab');
            } else {
              setStep('url');
            }
            setError(null);
          }}>
            Back
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/GDocImportDialog.tsx
git commit -m "feat: add GDocImportDialog multi-step import component"
```

---

## Chunk 3: NewEssayPage Integration

### Task 5: Add Google Docs import to NewEssayPage

**Files:**
- Modify: `src/pages/NewEssayPage.tsx`

- [ ] **Step 1: Add import state and dialog to NewEssayPage**

Modify `src/pages/NewEssayPage.tsx`. The full replacement file:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button, Select, TextInput, Textarea, Group, Text } from '@mantine/core';
import { functions, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { WRITING_TYPES, type WritingType, type DocSource } from '../types';
import { countWords } from '../utils';
import { handleRichPaste } from '../utils/pasteHandler';
import GDocImportDialog from '../components/GDocImportDialog';

export default function NewEssayPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [writingType, setWritingType] = useState<WritingType>('argumentative');
  const [assignmentPrompt, setAssignmentPrompt] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google Docs import state
  const [promptSource, setPromptSource] = useState<DocSource | null>(null);
  const [contentSource, setContentSource] = useState<DocSource | null>(null);
  const [importTarget, setImportTarget] = useState<'prompt' | 'essay' | null>(null);

  const wordCount = countWords(content);

  const handleImport = (text: string, source: DocSource) => {
    if (importTarget === 'prompt') {
      setAssignmentPrompt(text);
      setPromptSource(source);
    } else if (importTarget === 'essay') {
      setContent(text);
      setContentSource(source);
    }
    setImportTarget(null);
  };

  const clearPromptSource = () => {
    setPromptSource(null);
    setAssignmentPrompt('');
  };

  const clearContentSource = () => {
    setContentSource(null);
    setContent('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const essayRef = doc(collection(db, `users/${user.uid}/essays`));
      const draftRef = doc(collection(db, `users/${user.uid}/essays/${essayRef.id}/drafts`));

      await Promise.all([
        setDoc(essayRef, {
          title,
          assignmentPrompt,
          writingType,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          currentDraftNumber: 1,
          ...(promptSource && { promptSource }),
          ...(contentSource && { contentSource }),
        }),
        setDoc(draftRef, {
          draftNumber: 1,
          content,
          submittedAt: serverTimestamp(),
        }),
      ]);

      navigate(`/essay/${essayRef.id}`);

      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: 180000 });
      evaluateEssay({ essayId: essayRef.id, draftId: draftRef.id }).catch((err) => {
        console.error('Background evaluation failed:', err);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit essay. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>New Essay</h2>
      <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          maxLength={200}
          required
          placeholder="e.g., Hamlet Analysis"
          mb="md"
        />
        <Select
          label="Writing Type"
          value={writingType}
          onChange={(val) => val && setWritingType(val as WritingType)}
          data={WRITING_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
          mb="md"
        />

        {/* Assignment Prompt */}
        <Group justify="space-between" mb={4}>
          <Text fw={500} size="sm">Assignment Prompt <span style={{ color: 'red' }}>*</span></Text>
          {promptSource ? (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Imported from Google Docs</Text>
              <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('prompt')}>Change</Button>
              <Button variant="subtle" size="compact-xs" color="red" onClick={clearPromptSource}>Clear</Button>
            </Group>
          ) : (
            <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('prompt')}>
              Import from Google Docs
            </Button>
          )}
        </Group>
        <Textarea
          value={assignmentPrompt}
          onChange={(e) => {
            setAssignmentPrompt(e.currentTarget.value);
            if (promptSource) setPromptSource(null);
          }}
          maxLength={2000}
          required
          placeholder="Paste the assignment prompt here..."
          rows={3}
          description={`${assignmentPrompt.length}/2,000 characters`}
          mb="md"
          readOnly={!!promptSource}
        />

        {/* Essay Content */}
        <Group justify="space-between" mb={4}>
          <Text fw={500} size="sm">Your Essay <span style={{ color: 'red' }}>*</span></Text>
          {contentSource ? (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Imported from Google Docs</Text>
              <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('essay')}>Change</Button>
              <Button variant="subtle" size="compact-xs" color="red" onClick={clearContentSource}>Clear</Button>
            </Group>
          ) : (
            <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('essay')}>
              Import from Google Docs
            </Button>
          )}
        </Group>
        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.currentTarget.value);
            if (contentSource) setContentSource(null);
          }}
          onPaste={(e) => handleRichPaste(e, setContent)}
          required
          placeholder="Paste or type your essay here..."
          rows={16}
          description={`${wordCount.toLocaleString()} / 10,000 words`}
          error={wordCount > 10000 ? 'Essay exceeds 10,000 word limit' : undefined}
          mb="md"
          readOnly={!!contentSource}
        />

        {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}
        <Button type="submit" disabled={submitting || !title || !assignmentPrompt || !content || wordCount > 10000} loading={submitting}>
          Submit for Feedback
        </Button>
      </form>

      <GDocImportDialog
        opened={importTarget !== null}
        onClose={() => setImportTarget(null)}
        onImport={handleImport}
        label={importTarget === 'prompt' ? 'prompt' : 'essay'}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual test**

Run: `cd /home/ssilver/development/essay-grader && npx vite --open`

Test flow:
1. Navigate to New Essay page
2. Click "Import from Google Docs" next to essay field
3. Paste: `https://docs.google.com/document/d/1NxFIeG_c_6S1G5SOIm_F8SufAl_Vq_pI0yyjNn0w2zY/edit?tab=t.0`
4. Select "Letter" tab
5. Should show 3 sections (before first bookmark, between bookmarks, after last bookmark)
6. Select the essay section, confirm
7. Essay textarea should populate with the letter text

- [ ] **Step 4: Commit**

```bash
git add src/pages/NewEssayPage.tsx
git commit -m "feat: add Google Docs import to NewEssayPage for prompt and essay"
```

---

## Chunk 4: Backend — Doc Source Resolution

### Task 6: Server-side gdocResolver

**Files:**
- Create: `functions/src/gdocResolver.ts`
- Create: `functions/tests/gdocResolver.test.ts`

- [ ] **Step 1: Write tests for resolveDocSource**

Create `functions/tests/gdocResolver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDocSource } from '../src/gdocResolver';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('resolveDocSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches text and returns correct section', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'PromptText\nEssayText\nBibliography',
        bookmarks: [
          { id: 'bm1', offset: 11 },
          { id: 'bm2', offset: 21 },
        ],
        tabs: [],
        tabTitle: 'Letter',
        tabId: 't.0',
        textLength: 33,
      }),
    });

    const text = await resolveDocSource(
      { docId: 'doc123', tab: 'Letter', sectionIndex: 1 },
      'test-deployment-id',
    );
    expect(text).toBe('EssayText');
    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('docId=doc123');
    expect(url).toContain('tab=Letter');
  });

  it('returns full text when no bookmarks and sectionIndex 0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'Full essay text here',
        bookmarks: [],
        tabs: [],
        tabTitle: 'Tab1',
        tabId: 't.0',
        textLength: 20,
      }),
    });

    const text = await resolveDocSource(
      { docId: 'doc456', tab: 'Tab1', sectionIndex: 0 },
      'test-deployment-id',
    );
    expect(text).toBe('Full essay text here');
  });

  it('throws when section index is out of range', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'Only one section',
        bookmarks: [],
        tabs: [],
        tabTitle: 'Tab1',
        tabId: 't.0',
        textLength: 16,
      }),
    });

    await expect(
      resolveDocSource({ docId: 'doc789', tab: 'Tab1', sectionIndex: 5 }, 'test-id'),
    ).rejects.toThrow(/section/i);
  });

  it('throws when web app returns error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'Tab not found' }),
    });

    await expect(
      resolveDocSource({ docId: 'doc000', tab: 'Missing', sectionIndex: 0 }, 'test-id'),
    ).rejects.toThrow('Tab not found');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Server error' });

    await expect(
      resolveDocSource({ docId: 'doc000', tab: 'Tab', sectionIndex: 0 }, 'test-id'),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run tests/gdocResolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create functions/src/gdocResolver.ts**

```typescript
import { parseSections } from '../../shared/gdocTypes';
import type { DocSource, GDocWebAppResponse } from '../../shared/gdocTypes';

const WEBAPP_BASE = 'https://script.google.com/macros/s';

/**
 * Resolve a DocSource reference to fresh text by calling the Apps Script web app.
 * @param source - The doc reference (docId, tab, sectionIndex)
 * @param deploymentId - The Apps Script web app deployment ID
 * @returns The text content of the specified section
 */
export async function resolveDocSource(
  source: DocSource,
  deploymentId: string,
): Promise<string> {
  const params = new URLSearchParams({ docId: source.docId, tab: source.tab });
  const url = `${WEBAPP_BASE}/${deploymentId}/exec?${params}`;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Doc (${res.status})`);
  }

  const data: GDocWebAppResponse = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }

  const sections = parseSections(data.text, data.bookmarks);
  if (source.sectionIndex < 0 || source.sectionIndex >= sections.length) {
    throw new Error(
      `Section index ${source.sectionIndex} out of range (document has ${sections.length} section${sections.length === 1 ? '' : 's'})`,
    );
  }

  return sections[source.sectionIndex];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run tests/gdocResolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/src/gdocResolver.ts functions/tests/gdocResolver.test.ts
git commit -m "feat: add server-side gdocResolver for fetching text from Google Docs"
```

---

### Task 7: Update evaluateEssay to resolve doc sources

**Files:**
- Modify: `functions/src/evaluateEssay.ts`

- [ ] **Step 1: Add doc source resolution to evaluateEssay**

Modify `functions/src/evaluateEssay.ts`. Add imports at the top:

```typescript
import { defineString } from 'firebase-functions/params';
import { resolveDocSource } from './gdocResolver';
```

Add a param definition near the top (after `geminiApiKey`):

```typescript
const gdocWebAppId = defineString('GDOC_WEBAPP_DEPLOYMENT_ID', { default: '' });
```

In the handler, after reading `essayData` and `draftData` (around line 53-54), replace the simple destructuring with doc-source-aware resolution:

```typescript
    const essayData = essayDoc.data()!;
    let { assignmentPrompt, writingType } = essayData;
    let { content } = draftData;
    const { draftNumber } = draftData;

    // Re-fetch from Google Docs if doc sources are set
    const webAppId = gdocWebAppId.value();
    if (webAppId) {
      if (essayData.contentSource) {
        try {
          content = await resolveDocSource(essayData.contentSource, webAppId);
          // Update draft with fresh content
          await draftRef.update({ content });
        } catch (err) {
          console.warn('Failed to re-fetch essay from Google Docs, using stored content:', (err as Error).message);
        }
      }
      if (essayData.promptSource) {
        try {
          assignmentPrompt = await resolveDocSource(essayData.promptSource, webAppId);
          // Update essay with fresh prompt
          await essayRef.update({ assignmentPrompt });
        } catch (err) {
          console.warn('Failed to re-fetch prompt from Google Docs, using stored prompt:', (err as Error).message);
        }
      }
    }
```

- [ ] **Step 2: Set the deployment ID in Firebase config**

Run:
```bash
cd /home/ssilver/development/essay-grader
firebase functions:config:set gdoc.webapp_deployment_id="AKfycbwNu3jyPAQjR0IBZXKzEj_ueHdOlDR7bsznfwMPml6hFgF2nNAlIMBb3mUM8_I6L29RQg" --project essay-grader-83737x
```

Note: If using `defineString`, set it as an environment variable in `.env` in the functions directory instead:

Create `functions/.env`:
```
GDOC_WEBAPP_DEPLOYMENT_ID=AKfycbwNu3jyPAQjR0IBZXKzEj_ueHdOlDR7bsznfwMPml6hFgF2nNAlIMBb3mUM8_I6L29RQg
```

- [ ] **Step 3: Verify functions build**

Run: `cd functions && npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add functions/src/evaluateEssay.ts functions/.env
git commit -m "feat: resolve Google Doc sources in evaluateEssay before evaluation"
```

---

## Chunk 5: RevisionPage + Validation

### Task 8: Update validation to allow doc-sourced submissions

**Files:**
- Modify: `functions/src/validation.ts`
- Modify: `functions/tests/validation.test.ts`

- [ ] **Step 1: Add test for doc-sourced validation**

Add to `functions/tests/validation.test.ts`, in the `validateSubmitEssay` describe block:

```typescript
  it('accepts empty content when contentSource is provided', () => {
    expect(validateSubmitEssay({ ...valid, content: '' }, { hasContentSource: true })).toBeNull();
  });

  it('accepts empty prompt when promptSource is provided', () => {
    expect(validateSubmitEssay({ ...valid, assignmentPrompt: '' }, { hasPromptSource: true })).toBeNull();
  });
```

Add to the `validateResubmitDraft` describe block:

```typescript
  it('accepts empty content when contentSource is provided', () => {
    expect(validateResubmitDraft({ essayId: 'abc', content: '' }, { hasContentSource: true })).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run tests/validation.test.ts`
Expected: FAIL — function signature doesn't accept options

- [ ] **Step 3: Update validation functions**

Modify `functions/src/validation.ts`:

```typescript
const VALID_WRITING_TYPES = [
  'argumentative', 'narrative', 'expository',
  'persuasive', 'analytical', 'informational',
] as const;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

interface SubmitEssayInput {
  title: string;
  assignmentPrompt: string;
  writingType: string;
  content: string;
}

interface SubmitOptions {
  hasContentSource?: boolean;
  hasPromptSource?: boolean;
}

export function validateSubmitEssay(input: SubmitEssayInput, options?: SubmitOptions): string | null {
  if (!input.title || input.title.trim().length === 0) return 'Title is required';
  if (input.title.length > 200) return 'Title must be 200 characters or fewer';
  if (!options?.hasPromptSource) {
    if (!input.assignmentPrompt || input.assignmentPrompt.trim().length === 0) return 'Assignment prompt is required';
  }
  if (input.assignmentPrompt.length > 2000) return 'Assignment prompt must be 2,000 characters or fewer';
  if (!VALID_WRITING_TYPES.includes(input.writingType as any)) return `Invalid writing type: ${input.writingType}`;
  if (!options?.hasContentSource) {
    if (!input.content || input.content.trim().length === 0) return 'Essay content is required';
  }
  if (input.content && countWords(input.content) > 10000) return 'Essay content must be 10,000 words or fewer';
  return null;
}

interface ResubmitDraftInput {
  essayId: string;
  content: string;
}

interface ResubmitOptions {
  hasContentSource?: boolean;
}

export function validateResubmitDraft(input: ResubmitDraftInput, options?: ResubmitOptions): string | null {
  if (!input.essayId || input.essayId.trim().length === 0) return 'essayId is required';
  if (!options?.hasContentSource) {
    if (!input.content || input.content.trim().length === 0) return 'Essay content is required';
  }
  if (input.content && countWords(input.content) > 10000) return 'Essay content must be 10,000 words or fewer';
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run tests/validation.test.ts`
Expected: PASS (all existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/validation.ts functions/tests/validation.test.ts
git commit -m "feat: update validation to allow empty content/prompt when doc source provided"
```

---

### Task 9: Update RevisionPage for doc-sourced essays

**Files:**
- Modify: `src/pages/RevisionPage.tsx`

- [ ] **Step 1: Update RevisionPage to handle doc-sourced essays**

Modify `src/pages/RevisionPage.tsx`. Add imports at the top:

```typescript
import type { DocSource } from '../types';
import { fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
```

After the existing state declarations (around line 25), add:

```typescript
  const [refetching, setRefetching] = useState(false);
```

Replace the `handleResubmit` function with a version that re-fetches from Google Docs:

```typescript
  const handleResubmit = async () => {
    if (retryCount >= 3 || !essayId || !user || !latestDraft || ownerUid) return;
    setSubmitting(true);
    setError(null);
    try {
      let essayContent = content;

      // Re-fetch from Google Docs if content is doc-sourced
      if (essay?.contentSource) {
        setRefetching(true);
        try {
          const data = await fetchGDocInfo(essay.contentSource.docId, essay.contentSource.tab);
          const sections = parseSections(data.text, data.bookmarks);
          if (essay.contentSource.sectionIndex < sections.length) {
            essayContent = sections[essay.contentSource.sectionIndex];
          }
        } catch (err) {
          console.warn('Failed to re-fetch from Google Docs, using current content:', err);
        }
        setRefetching(false);
      }

      const uid = user.uid;
      const newDraftNumber = (essay?.currentDraftNumber ?? latestDraft.draftNumber) + 1;
      const essayRef = doc(db, `users/${uid}/essays/${essayId}`);
      const draftRef = doc(collection(db, `users/${uid}/essays/${essayId}/drafts`));

      await Promise.all([
        setDoc(draftRef, {
          draftNumber: newDraftNumber,
          content: essayContent,
          submittedAt: serverTimestamp(),
        }),
        updateDoc(essayRef, {
          currentDraftNumber: newDraftNumber,
          updatedAt: serverTimestamp(),
        }),
      ]);

      localStorage.removeItem(`essaycoach_autosave_${essayId}`);
      navigate(`/essay/${essayId}`);

      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: 180000 });
      evaluateEssay({ essayId, draftId: draftRef.id }).catch((err) => {
        console.error('Background evaluation failed:', err);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit. Please try again.');
      setRetryCount((c) => c + 1);
      setSubmitting(false);
    }
  };
```

In the JSX, update the editor section to show a message for doc-sourced essays. Replace the `revision-layout` div (around line 142-163):

```tsx
      {/* Essay editor with annotation sidebar for reference */}
      <div className="revision-layout">
        <div className="revision-editor">
          {essay?.contentSource ? (
            <div style={{ padding: 16, background: 'var(--mantine-color-gray-0)', borderRadius: 8, height: '100%' }}>
              <Text size="sm" c="dimmed" mb="sm">
                This essay is linked to a Google Doc. Edit your essay in Google Docs, then click Resubmit to re-import and evaluate the latest version.
              </Text>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{content}</Text>
            </div>
          ) : (
            <textarea
              className="essay-editor"
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onPaste={(e) => handleRichPaste(e, handleContentChange)}
            />
          )}
        </div>
        <div className="revision-annotations">
          <div className="revision-annotations-header">Feedback</div>
          {(selectedTrait
            ? allAnnotations.filter(a => a.traitKey === selectedTrait)
            : allAnnotations
          ).map((ann, i) => (
            <div key={i} className={`sidebar-comment ${classifyAnnotation(ann.comment)}`} style={{ position: 'static' }}>
              <span className="sidebar-comment-trait">{ann.traitLabel}</span>
              <span className="sidebar-comment-text">{ann.comment}</span>
            </div>
          ))}
        </div>
      </div>
```

Also update the Resubmit button to show refetching state:

```tsx
          {!ownerUid && (
            <Button size="compact-sm" onClick={handleResubmit} disabled={submitting || retryCount >= 3} loading={submitting || refetching}>
              {refetching ? 'Re-importing...' : 'Resubmit'}
            </Button>
          )}
```

- [ ] **Step 2: Add contentSource to Essay type in types.ts**

This was already done in Task 1, Step 5. Verify it's there:

```typescript
export interface Essay {
  // ...
  promptSource?: DocSource | null;
  contentSource?: DocSource | null;
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/pages/RevisionPage.tsx
git commit -m "feat: RevisionPage handles doc-sourced essays with re-fetch on resubmit"
```

---

### Task 10: Run all tests and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `cd functions && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run frontend type check**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build functions**

Run: `cd functions && npm run build`
Expected: No errors

- [ ] **Step 4: End-to-end manual test**

Start dev server: `cd /home/ssilver/development/essay-grader && npx vite`

Test the full flow:
1. New Essay → Import essay from Google Docs (test doc, Letter tab, pick essay section)
2. Import prompt from Google Docs (or type one)
3. Submit → verify evaluation runs with imported text
4. Go to Revision page → verify essay shows as read-only with Google Docs message
5. Click Resubmit → verify it re-fetches and evaluates

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Google Docs import integration"
```
