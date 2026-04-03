import { describe, it, expect, vi, afterEach } from 'vitest';
import { relativeTime, scoreColor, scoreLevel, scoreLabel } from './utils';

describe('relativeTime', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns "Just now" for < 1 minute ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:30Z'));
    expect(relativeTime(new Date('2026-03-16T12:00:00Z'))).toBe('Just now');
  });

  it('returns "Xm ago" for < 1 hour ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:25:00Z'));
    expect(relativeTime(new Date('2026-03-16T12:00:00Z'))).toBe('25m ago');
  });

  it('returns "Xh ago" for 1-23 hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T15:00:00Z'));
    expect(relativeTime(new Date('2026-03-16T12:00:00Z'))).toBe('3h ago');
  });

  it('returns "Yesterday, H:MM AM/PM" for yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'));
    const result = relativeTime(new Date('2026-03-15T16:30:00Z'));
    expect(result).toMatch(/^Yesterday,/);
  });

  it('returns "Mon DD, H:MM AM/PM" for older dates this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'));
    const result = relativeTime(new Date('2026-02-10T09:15:00Z'));
    expect(result).toMatch(/Feb 10/);
  });

  it('returns "Mon DD, YYYY, H:MM AM/PM" for dates in a prior year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'));
    const result = relativeTime(new Date('2025-06-05T14:00:00Z'));
    expect(result).toMatch(/2025/);
  });
});

describe('score semantics', () => {
  it('maps scoreLevel across the full bucket boundaries', () => {
    expect(scoreLevel(1)).toBe('low');
    expect(scoreLevel(2)).toBe('low');
    expect(scoreLevel(3)).toBe('mid');
    expect(scoreLevel(4)).toBe('mid');
    expect(scoreLevel(5)).toBe('high');
  });

  it('maps scoreColor across the full bucket boundaries', () => {
    expect(scoreColor(2)).toBe('var(--color-red)');
    expect(scoreColor(4)).toBe('var(--color-yellow)');
    expect(scoreColor(5)).toBe('var(--color-green)');
  });

  it('maps scoreLabel to per-score rubric names', () => {
    expect(scoreLabel(1)).toBe('Beginning');
    expect(scoreLabel(2)).toBe('Emerging');
    expect(scoreLabel(3)).toBe('Developing');
    expect(scoreLabel(4)).toBe('Capable');
    expect(scoreLabel(5)).toBe('Strong');
    expect(scoreLabel(6)).toBe('Exceptional');
  });
});
