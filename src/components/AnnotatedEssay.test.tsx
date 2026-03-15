import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import AnnotatedEssay from './AnnotatedEssay';
import type { TraitAnnotation } from './AnnotatedEssay';

const makeAnnotation = (quotedText: string, comment: string): TraitAnnotation => ({
  quotedText, comment, traitKey: 'ideas', traitLabel: 'Ideas',
});

describe('AnnotatedEssay', () => {
  it('renders essay content in a textarea when editable', () => {
    renderWithRouter(
      <AnnotatedEssay content="My essay text" annotations={[]} onChange={vi.fn()} readOnly={false} />
    );
    expect(screen.getByDisplayValue('My essay text')).toBeInTheDocument();
  });

  it('calls onChange when text is edited', async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <AnnotatedEssay content="" annotations={[]} onChange={onChange} readOnly={false} />
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders highlighted passages in read-only mode', () => {
    const { container } = renderWithRouter(
      <AnnotatedEssay
        content="This is a good play about things and stuff."
        annotations={[makeAnnotation('good play about things', 'Too vague')]}
        readOnly
      />
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toContain('good play about things');
  });

  it('gracefully handles missing quoted text', () => {
    const { container } = renderWithRouter(
      <AnnotatedEssay
        content="This is my essay."
        annotations={[makeAnnotation('nonexistent passage', 'Comment')]}
        readOnly
      />
    );
    const mark = container.querySelector('mark');
    expect(mark).not.toBeInTheDocument();
  });

  it('shows annotation comment on click', async () => {
    renderWithRouter(
      <AnnotatedEssay
        content="This is a good play about things and stuff."
        annotations={[makeAnnotation('good play about things', 'Too vague — be more specific')]}
        readOnly
      />
    );
    const mark = screen.getByRole('button');
    await userEvent.click(mark);
    expect(screen.getByText('Too vague — be more specific')).toBeInTheDocument();
  });
});
