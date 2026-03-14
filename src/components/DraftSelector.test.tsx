import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import DraftSelector from './DraftSelector';
import type { Draft } from '../types';

const drafts: Draft[] = [
  { id: 'd2', draftNumber: 2, content: '', submittedAt: new Date('2026-03-13'), evaluation: null, revisionStage: null },
  { id: 'd1', draftNumber: 1, content: '', submittedAt: new Date('2026-03-12'), evaluation: null, revisionStage: null },
];

describe('DraftSelector', () => {
  it('renders nothing when only one draft', () => {
    const { container } = renderWithRouter(
      <DraftSelector drafts={[drafts[0]]} selectedDraftId="d2" onChange={vi.fn()} />
    );
    expect(container.querySelector('select')).not.toBeInTheDocument();
  });

  it('renders dropdown with draft options', () => {
    renderWithRouter(
      <DraftSelector drafts={drafts} selectedDraftId="d2" onChange={vi.fn()} />
    );
    expect(screen.getByText(/Draft 2/)).toBeInTheDocument();
    expect(screen.getByText(/Draft 1/)).toBeInTheDocument();
  });

  it('calls onChange when selection changes', async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <DraftSelector drafts={drafts} selectedDraftId="d2" onChange={onChange} />
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'd1');
    expect(onChange).toHaveBeenCalledWith('d1');
  });
});
