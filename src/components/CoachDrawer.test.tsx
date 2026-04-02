import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import CoachDrawer from './CoachDrawer';
import type { DraftEntity } from '../entities/draftEntity';
import type { DraftPresentation } from '../entities/draftPresentation';
import type { DraftEditorState } from '../hooks/useDraftEditor';
import type { NavbarMeta } from '../hooks/useNavbarContext';

const entity = {
  id: 'draft-1',
  raw: {
    id: 'draft-1',
    content: '',
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    revisionStage: null,
    evaluation: null,
    evaluationStatus: null,
    transitionAnalysis: null,
    transitionStatus: null,
    grammarAnalysis: null,
    grammarStatus: null,
    promptAnalysis: null,
    promptStatus: null,
    coachSynthesis: null,
    coachSynthesisStatus: null,
    editedAt: null,
    lastScannedAt: null,
  },
  analysisStatus: vi.fn(),
  statusMessage: vi.fn(),
  issueCount: vi.fn((key: string) => {
    switch (key) {
      case 'overall': return 0;
      case 'grammar': return 1;
      case 'transitions': return 3;
      case 'prompt': return undefined;
      default: return undefined;
    }
  }),
  coachReadiness: 'ready',
  coachNote: 'Ready to review.',
  recommendedReport: null,
  contentEdited: false,
} satisfies DraftEntity;

const presentation = {
  reports: {
    overall: { status: 'ready', issueCount: 0, isRecommended: false, statusMessage: null },
    grammar: { status: 'ready', issueCount: 1, isRecommended: false, statusMessage: null },
    transitions: { status: 'ready', issueCount: 3, isRecommended: false, statusMessage: null },
    prompt: { status: 'unavailable', issueCount: undefined, isRecommended: false, statusMessage: null },
  },
  verdict: {
    phase: 'has_verdict',
    coachReadiness: 'ready',
    coachNote: 'Ready to review.',
    recommendedReport: null,
  },
  canEdit: false,
  hasPrompt: true,
  isLatest: true,
} satisfies DraftPresentation;

const editor = {
  content: '',
  onChange: vi.fn(),
  save: vi.fn(),
  saving: false,
  lastSaved: null,
  hasUnsavedEdits: false,
  saveError: null,
} satisfies DraftEditorState;

const meta = {
  activeReport: 'overall',
  onSelectReport: vi.fn(),
  draftOptions: [],
  onPickDraft: vi.fn(),
  onReanalyze: vi.fn(),
  reanalyzing: false,
  gdocChanged: false,
  gdocLastChecked: null,
} satisfies NavbarMeta;

describe('CoachDrawer', () => {
  it('maps a 0 issue report to the clear count class', () => {
    renderWithRouter(<CoachDrawer entity={entity} presentation={presentation} editor={editor} meta={meta} />);

    const row = screen.getByText('Overall').closest('.coach-sb-report');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('0').className).toContain('coach-sb-count-clear');
  });

  it('maps a 1 issue report to the few count class', () => {
    renderWithRouter(<CoachDrawer entity={entity} presentation={presentation} editor={editor} meta={meta} />);

    const row = screen.getByText('Grammar').closest('.coach-sb-report');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('1').className).toContain('coach-sb-count-few');
  });

  it('maps a 3 issue report to the issues count class', () => {
    renderWithRouter(<CoachDrawer entity={entity} presentation={presentation} editor={editor} meta={meta} />);

    const row = screen.getByText('Transitions').closest('.coach-sb-report');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('3').className).toContain('coach-sb-count-issues');
  });

  it('maps an unavailable report count to a dedicated unavailable class', () => {
    renderWithRouter(<CoachDrawer entity={entity} presentation={presentation} editor={editor} meta={meta} />);

    const row = screen.getByText('Prompt Fit').closest('.coach-sb-report');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('—').className).toContain('coach-sb-count-unavailable');
  });
});
