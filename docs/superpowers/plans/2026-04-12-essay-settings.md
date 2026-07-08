# Essay Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gear icon in the essay header for quick settings edits via modal, and a full `/essay/:id/edit` page for reworking essay metadata.

**Architecture:** New `EssaySettingsModal` component opened from a gear icon in `AppHeader`. New `EditEssayPage` route reusing `ContentInput`. Both write to the essay Firestore doc and clear stale analyses on the current draft. Extends `EssayHeaderContext` with `onOpenSettings` callback.

**Tech Stack:** React, Mantine, Firebase Firestore, ContentInput component

**Spec:** `docs/superpowers/specs/2026-04-12-essay-settings-design.md`

---

### Task 1: Extend EssayHeaderContext with onOpenSettings

**Files:**
- Modify: `src/components/AppHeader.tsx`

- [ ] **Step 1: Add `onOpenSettings` to `EssayHeaderContext`**

In `src/components/AppHeader.tsx`, extend the `EssayHeaderContext` interface:

```typescript
export interface EssayHeaderContext {
  title: string;
  draftLabel: string;
  activeDraftId?: string;
  draftOptions?: DraftOption[];
  onPickDraft?: (id: string) => void;
  toolbar?: ReactNode;
  onOpenSettings?: () => void;
}
```

- [ ] **Step 2: Add gear icon to `EssayHeader`**

In the `EssayHeader` function component, add a clickable gear character next to the title. Only render when `onOpenSettings` is provided:

```tsx
function EssayHeader({ title, draftLabel, onOpenSettings }: EssayHeaderContext) {
  return (
    <div className="app-header app-header-essay app-header-essay-single">
      <Link to="/" className="app-header-brand">EssayCoach</Link>
      <span className="app-header-sep">&rsaquo;</span>
      <span className="app-header-title">{title}</span>
      {onOpenSettings && (
        <button className="app-header-settings-btn" onClick={onOpenSettings} title="Essay settings">
          ⚙
        </button>
      )}
      <span className="app-header-draft-label">{draftLabel}</span>
      <div style={{ marginLeft: 'auto' }}>
        <UserAvatarMenu />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add CSS for the settings button**

Add to `src/index.css` (near the other `.app-header-*` styles):

```css
.app-header-settings-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-muted);
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 150ms ease, background 150ms ease;
  line-height: 1;
}
.app-header-settings-btn:hover {
  color: var(--color-text);
  background: var(--color-surface-warm);
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/AppHeader.tsx src/index.css
git commit -m "feat: add gear icon to essay header for settings"
```

---

### Task 2: EssaySettingsModal Component

**Files:**
- Create: `src/components/EssaySettingsModal.tsx`

- [ ] **Step 1: Create the modal component**

```tsx
import { useState, useEffect } from 'react';
import { Modal, Select, TextInput, Button, Group, Stack } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { Essay, WritingType, DocSource } from '../types';
import { WRITING_TYPES } from '../types';
import ContentInput from './ContentInput';

interface EssaySettingsModalProps {
  opened: boolean;
  onClose: () => void;
  essay: Essay;
  essayId: string;
  ownerUid?: string;
  onSave: (updates: EssaySettingsUpdate) => Promise<void>;
  editPageUrl: string;
}

export interface EssaySettingsUpdate {
  title: string;
  writingType: WritingType;
  assignmentPrompt: string;
  promptSource: DocSource | null;
  teacherCriteria: string | null;
  criteriaSource: DocSource | null;
}

export default function EssaySettingsModal({
  opened,
  onClose,
  essay,
  essayId,
  ownerUid,
  onSave,
  editPageUrl,
}: EssaySettingsModalProps) {
  const [title, setTitle] = useState(essay.title);
  const [writingType, setWritingType] = useState<WritingType>(essay.writingType);
  const [assignmentPrompt, setAssignmentPrompt] = useState(essay.assignmentPrompt);
  const [promptSource, setPromptSource] = useState<DocSource | null>(essay.promptSource ?? null);
  const [teacherCriteria, setTeacherCriteria] = useState(essay.teacherCriteria ?? '');
  const [criteriaSource, setCriteriaSource] = useState<DocSource | null>(essay.criteriaSource ?? null);
  const [saving, setSaving] = useState(false);
  const [importTarget, setImportTarget] = useState<'prompt' | 'criteria' | null>(null);

  // Sync state when essay changes or modal reopens
  useEffect(() => {
    if (opened) {
      setTitle(essay.title);
      setWritingType(essay.writingType);
      setAssignmentPrompt(essay.assignmentPrompt);
      setPromptSource(essay.promptSource ?? null);
      setTeacherCriteria(essay.teacherCriteria ?? '');
      setCriteriaSource(essay.criteriaSource ?? null);
    }
  }, [opened, essay]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        title,
        writingType,
        assignmentPrompt,
        promptSource,
        teacherCriteria: teacherCriteria.trim() || null,
        criteriaSource,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // GDoc import handler — reuse the same pattern as NewEssayPage
  const handlePickerImport = async (target: 'prompt' | 'criteria') => {
    try {
      const { openGooglePicker } = await import('../utils/googlePicker');
      const result = await openGooglePicker(undefined, target === 'prompt' ? 'assignment prompt' : 'teacher criteria');
      if (!result) return;
      setImportTarget(target);
      // GDocImportDialog will be opened by importTarget state
    } catch {
      setImportTarget(target);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Essay Settings" size="lg">
      <Stack gap="md">
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
        />
        <Select
          label="Writing Type"
          value={writingType}
          onChange={(val) => val && setWritingType(val as WritingType)}
          data={WRITING_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
          withCheckIcon={false}
          w="fit-content"
          styles={{ input: { minWidth: 160 } }}
        />
        <ContentInput
          label="Assignment Prompt"
          required
          value={assignmentPrompt}
          onChange={(v) => { setAssignmentPrompt(v); if (promptSource) setPromptSource(null); }}
          imported={!!promptSource}
          onImportClick={() => handlePickerImport('prompt')}
          onClear={() => { setAssignmentPrompt(''); setPromptSource(null); }}
          placeholder="Paste the assignment prompt here..."
          maxLength={10000}
          minRows={3}
          maxRows={6}
        />
        <ContentInput
          label="Teacher Criteria"
          optional
          value={teacherCriteria}
          onChange={(v) => { setTeacherCriteria(v); if (criteriaSource) setCriteriaSource(null); }}
          imported={!!criteriaSource}
          onImportClick={() => handlePickerImport('criteria')}
          onClear={() => { setTeacherCriteria(''); setCriteriaSource(null); }}
          placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."
          minRows={3}
          maxRows={6}
        />
        <Group justify="space-between">
          <Button
            component={Link}
            to={editPageUrl}
            variant="subtle"
            size="compact-sm"
            onClick={onClose}
          >
            Open full editor
          </Button>
          <Group gap="xs">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!title.trim() || !assignmentPrompt.trim()}>
              Save Changes
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/EssaySettingsModal.tsx
git commit -m "feat: EssaySettingsModal component with ContentInput fields"
```

---

### Task 3: Wire Settings Modal into EssayPage

**Files:**
- Modify: `src/pages/EssayPage.tsx`

- [ ] **Step 1: Add state and save handler**

Add imports:
```typescript
import EssaySettingsModal, { type EssaySettingsUpdate } from '../components/EssaySettingsModal';
```

Add state:
```typescript
const [settingsOpen, setSettingsOpen] = useState(false);
```

Add save handler that writes to Firestore and clears affected analyses:
```typescript
const handleSaveSettings = useCallback(async (updates: EssaySettingsUpdate) => {
  if (!essayId || !user) return;
  const uid = ownerUid ?? user.uid;
  const essayRef = doc(db, 'users', uid, 'essays', essayId);

  // Determine which fields changed
  const promptChanged = updates.assignmentPrompt !== essay?.assignmentPrompt;
  const criteriaChanged = (updates.teacherCriteria ?? '') !== (essay?.teacherCriteria ?? '');
  const typeChanged = updates.writingType !== essay?.writingType;

  // Write essay doc updates
  await updateDoc(essayRef, {
    title: updates.title,
    writingType: updates.writingType,
    assignmentPrompt: updates.assignmentPrompt,
    promptSource: updates.promptSource,
    teacherCriteria: updates.teacherCriteria,
    criteriaSource: updates.criteriaSource,
  });

  // Clear stale analyses on current draft
  if (activeDraft) {
    const draftDocRef = doc(db, 'users', uid, 'essays', essayId, 'drafts', activeDraft.id);
    const clears: Record<string, null> = {};
    if (typeChanged) {
      clears.evaluation = null;
      clears.evaluationStatus = null;
    }
    if (promptChanged) {
      clears.promptAnalysis = null;
      clears.promptStatus = null;
    }
    if (criteriaChanged) {
      clears.criteriaAnalysis = null;
      clears.criteriaStatus = null;
      clears.criteriaSnapshot = null;
    }
    if (Object.keys(clears).length > 0) {
      await updateDoc(draftDocRef, clears);
    }
  }
}, [essayId, user, ownerUid, essay, activeDraft]);
```

- [ ] **Step 2: Pass `onOpenSettings` to header context**

In the `useEffect` that calls `setEssayHeader`, add `onOpenSettings`:

```typescript
setEssayHeader({
  title: essay.title,
  draftLabel: ...,
  onOpenSettings: () => setSettingsOpen(true),
});
```

- [ ] **Step 3: Render the modal**

Add before the closing `</div>` of the component return:

```tsx
{essay && (
  <EssaySettingsModal
    opened={settingsOpen}
    onClose={() => setSettingsOpen(false)}
    essay={essay}
    essayId={essayId!}
    ownerUid={ownerUid}
    onSave={handleSaveSettings}
    editPageUrl={ownerUid ? `/user/${ownerUid}/essay/${essayId}/edit` : `/essay/${essayId}/edit`}
  />
)}
```

- [ ] **Step 4: Verify types compile**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/pages/EssayPage.tsx
git commit -m "feat: wire settings modal into EssayPage with analysis clearing"
```

---

### Task 4: EditEssayPage — Full Edit Route

**Files:**
- Create: `src/pages/EditEssayPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `EditEssayPage`**

A full-page form similar to NewEssayPage, but pre-filled with existing essay data. Uses `useEssay` hook to load data.

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { Button, Select, TextInput } from '@mantine/core';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useEssay } from '../hooks/useEssay';
import { WRITING_TYPES, type WritingType, type DocSource } from '../types';
import ContentInput from '../components/ContentInput';
import { openGooglePicker } from '../utils/googlePicker';
import GDocImportDialog from '../components/GDocImportDialog';

export default function EditEssayPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essay, drafts } = useEssay(essayId, ownerUid);

  const [title, setTitle] = useState('');
  const [writingType, setWritingType] = useState<WritingType>('argumentative');
  const [assignmentPrompt, setAssignmentPrompt] = useState('');
  const [promptSource, setPromptSource] = useState<DocSource | null>(null);
  const [teacherCriteria, setTeacherCriteria] = useState('');
  const [criteriaSource, setCriteriaSource] = useState<DocSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [importTarget, setImportTarget] = useState<'prompt' | 'criteria' | null>(null);
  const [lastImportedUrl, setLastImportedUrl] = useState('');
  const [lastImportedDocName, setLastImportedDocName] = useState('');

  // Pre-fill form from essay data (once)
  useEffect(() => {
    if (essay && !loaded) {
      setTitle(essay.title);
      setWritingType(essay.writingType);
      setAssignmentPrompt(essay.assignmentPrompt);
      setPromptSource(essay.promptSource ?? null);
      setTeacherCriteria(essay.teacherCriteria ?? '');
      setCriteriaSource(essay.criteriaSource ?? null);
      setLoaded(true);
    }
  }, [essay, loaded]);

  const handlePickerImport = async (target: 'prompt' | 'criteria') => {
    try {
      const purposeLabels = { prompt: 'assignment prompt', criteria: 'teacher criteria' };
      const result = await openGooglePicker(user?.email ?? undefined, purposeLabels[target]);
      if (!result) return;
      setLastImportedUrl(result.url);
      setLastImportedDocName(result.name);
      setImportTarget(target);
    } catch {
      setImportTarget(target);
    }
  };

  const handleImport = (text: string, source: DocSource) => {
    if (importTarget === 'prompt') {
      setAssignmentPrompt(text);
      setPromptSource(source);
    } else if (importTarget === 'criteria') {
      setTeacherCriteria(text);
      setCriteriaSource(source);
    }
    setImportTarget(null);
  };

  const handleSave = useCallback(async () => {
    if (!essayId || !user || !essay) return;
    setSaving(true);
    try {
      const uid = ownerUid ?? user.uid;
      const essayRef = doc(db, 'users', uid, 'essays', essayId);

      const promptChanged = assignmentPrompt !== essay.assignmentPrompt;
      const criteriaChanged = (teacherCriteria.trim() || null) !== (essay.teacherCriteria ?? null);
      const typeChanged = writingType !== essay.writingType;

      await updateDoc(essayRef, {
        title,
        writingType,
        assignmentPrompt,
        promptSource,
        teacherCriteria: teacherCriteria.trim() || null,
        criteriaSource,
      });

      // Clear stale analyses on latest draft
      const latestDraft = drafts[0];
      if (latestDraft) {
        const draftRef = doc(db, 'users', uid, 'essays', essayId, 'drafts', latestDraft.id);
        const clears: Record<string, null> = {};
        if (typeChanged) { clears.evaluation = null; clears.evaluationStatus = null; }
        if (promptChanged) { clears.promptAnalysis = null; clears.promptStatus = null; }
        if (criteriaChanged) { clears.criteriaAnalysis = null; clears.criteriaStatus = null; clears.criteriaSnapshot = null; }
        if (Object.keys(clears).length > 0) {
          await updateDoc(draftRef, clears);
        }
      }

      // Navigate back to essay view
      const basePath = ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`;
      navigate(`${basePath}/overall`);
    } finally {
      setSaving(false);
    }
  }, [essayId, user, ownerUid, essay, drafts, title, writingType, assignmentPrompt, promptSource, teacherCriteria, criteriaSource, navigate]);

  if (!essay) return <div className="center">Loading...</div>;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px' }}>
      <h2>Edit Essay Settings</h2>
      <div style={{ marginTop: 20 }}>
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
          mb="md"
        />
        <Select
          label="Writing Type"
          value={writingType}
          onChange={(val) => val && setWritingType(val as WritingType)}
          data={WRITING_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
          withCheckIcon={false}
          w="fit-content"
          styles={{ input: { minWidth: 160 } }}
          mb="md"
        />
        <ContentInput
          label="Assignment Prompt"
          required
          value={assignmentPrompt}
          onChange={(v) => { setAssignmentPrompt(v); if (promptSource) setPromptSource(null); }}
          imported={!!promptSource}
          onImportClick={() => handlePickerImport('prompt')}
          onClear={() => { setAssignmentPrompt(''); setPromptSource(null); }}
          placeholder="Paste the assignment prompt here..."
          maxLength={10000}
          minRows={3}
          maxRows={8}
        />
        <ContentInput
          label="Teacher Criteria"
          optional
          value={teacherCriteria}
          onChange={(v) => { setTeacherCriteria(v); if (criteriaSource) setCriteriaSource(null); }}
          imported={!!criteriaSource}
          onImportClick={() => handlePickerImport('criteria')}
          onClear={() => { setTeacherCriteria(''); setCriteriaSource(null); }}
          placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."
          minRows={3}
          maxRows={8}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="subtle" onClick={() => navigate(-1)}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!title.trim() || !assignmentPrompt.trim()}>
            Save Changes
          </Button>
        </div>
      </div>
      <GDocImportDialog
        opened={importTarget !== null}
        onClose={() => setImportTarget(null)}
        onImport={handleImport}
        label={importTarget === 'prompt' ? 'prompt' : 'criteria'}
        initialUrl={lastImportedUrl}
        initialDocName={lastImportedDocName}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add routes to `App.tsx`**

After the existing `/essay/:essayId/criteria` route, add:
```tsx
<Route path="/essay/:essayId/edit" element={<EditEssayPage />} />
```

After the existing `/user/:ownerUid/essay/:essayId/criteria` route, add:
```tsx
<Route path="/user/:ownerUid/essay/:essayId/edit" element={<EditEssayPage />} />
```

Add the import at the top:
```typescript
import EditEssayPage from './pages/EditEssayPage';
```

- [ ] **Step 3: Verify types compile and build succeeds**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/pages/EditEssayPage.tsx src/App.tsx
git commit -m "feat: EditEssayPage with /essay/:id/edit route"
```

---

### Task 5: Visual Verification with Browse

**Files:** None — manual testing

- [ ] **Step 1: Build and verify locally**

Run: `npm run build`

- [ ] **Step 2: Test gear icon**

Using browse tool, navigate to an essay page. Verify:
- Gear icon appears next to essay title in header
- Clicking gear opens the settings modal
- Modal shows pre-filled title, writing type, assignment prompt, teacher criteria
- "Open full editor" link navigates to `/essay/:id/edit`
- Save writes changes and closes modal

- [ ] **Step 3: Test full edit page**

Navigate to `/essay/:id/edit`. Verify:
- Form pre-fills with existing essay data
- ContentInput fields work (expand, paste, import)
- Save writes changes and navigates back to essay view
- Cancel navigates back

- [ ] **Step 4: Deploy**

```bash
firebase deploy --only hosting --project essay-grader-83737x
```
