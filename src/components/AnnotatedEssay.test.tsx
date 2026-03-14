import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import AnnotatedEssay from './AnnotatedEssay';

describe('AnnotatedEssay', () => {
  it('renders essay content in a textarea when editable', () => {
    renderWithRouter(
      <AnnotatedEssay content="My essay text" annotations={[]} onChange={vi.fn()} />
    );
    expect(screen.getByDisplayValue('My essay text')).toBeInTheDocument();
  });

  it('calls onChange when text is edited', async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <AnnotatedEssay content="" annotations={[]} onChange={onChange} />
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders highlighted passages in read-only mode', () => {
    const { container } = renderWithRouter(
      <AnnotatedEssay
        content="This is a good play about things and stuff."
        annotations={[{ quotedText: 'good play about things', comment: 'Too vague' }]}
        onChange={vi.fn()}
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
        annotations={[{ quotedText: 'nonexistent passage', comment: 'Comment' }]}
        onChange={vi.fn()}
        readOnly
      />
    );
    const mark = container.querySelector('mark');
    expect(mark).not.toBeInTheDocument();
  });
});
