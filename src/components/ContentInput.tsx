import { useState, useRef, useCallback, useEffect } from 'react';
import { Text, Group, Button, Textarea, UnstyledButton } from '@mantine/core';
import { handleRichPaste } from '../utils/pasteHandler';
import { countWords } from '../utils';

interface ContentInputProps {
  label: string;
  required?: boolean;
  optional?: boolean;
  value: string;
  onChange: (value: string) => void;
  imported?: boolean;
  onImportClick: () => void;
  onClear: () => void;
  placeholder?: string;
  maxLength?: number;
  minRows?: number;
  maxRows?: number;
  showWordCount?: boolean;
  wordLimit?: number;
}

type Mode = 'collapsed' | 'typing' | 'preview';

export default function ContentInput({
  label,
  required,
  optional,
  value,
  onChange,
  imported,
  onImportClick,
  onClear,
  placeholder = 'Paste or type here...',
  maxLength,
  minRows = 4,
  maxRows = 12,
  showWordCount,
  wordLimit,
}: ContentInputProps) {
  const [mode, setMode] = useState<Mode>(() => value.trim() ? 'preview' : 'collapsed');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync mode when value changes externally (e.g. import fills it)
  useEffect(() => {
    if (mode === 'typing') return;
    setMode(value.trim() ? 'preview' : 'collapsed');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const expand = useCallback(() => {
    if (imported) return; // imported content can't be typed into
    setMode('typing');
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [imported]);

  const handleBlur = useCallback(() => {
    setMode(value.trim() ? 'preview' : 'collapsed');
  }, [value]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    handleRichPaste(e, onChange);
  }, [onChange]);

  const handleClear = useCallback(() => {
    onClear();
    setMode('collapsed');
  }, [onClear]);

  // Intercept paste while collapsed
  const handleCollapsedPaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const plain = e.clipboardData.getData('text/plain');
    if (plain) {
      onChange(plain);
      setMode('preview');
    }
  }, [onChange]);

  const truncated = value.length > 200 ? value.slice(0, 200) + '...' : value;
  const wordCount = showWordCount ? countWords(value) : 0;

  return (
    <div style={{ marginBottom: 'var(--mantine-spacing-md)' }}>
      <Text fw={500} size="sm" mb={4} style={{ fontFamily: 'var(--font-ui)' }}>
        {label}
        {required && <span style={{ color: 'red' }}> *</span>}
        {optional && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> (optional)</span>}
      </Text>

      {mode === 'collapsed' && (
        <div
          className="content-input-zone"
          onPaste={handleCollapsedPaste}
          tabIndex={0}
          onFocus={expand}
          onKeyDown={(e) => {
            if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) expand();
          }}
        >
          <Group gap="lg" justify="center">
            <UnstyledButton onClick={expand} className="content-input-action">
              <span className="content-input-action-icon">✎</span>
              <span>Type or paste</span>
            </UnstyledButton>
            <span className="content-input-divider">or</span>
            <UnstyledButton onClick={onImportClick} className="content-input-action">
              <span className="content-input-action-icon">⬡</span>
              <span>Import from Docs</span>
            </UnstyledButton>
          </Group>
        </div>
      )}

      {mode === 'typing' && (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          onPaste={handlePaste}
          onBlur={handleBlur}
          placeholder={placeholder}
          autosize
          minRows={minRows}
          maxRows={maxRows}
          maxLength={maxLength}
          error={wordLimit && wordCount > wordLimit ? `Exceeds ${wordLimit.toLocaleString()} word limit` : undefined}
          styles={{
            input: {
              fontFamily: 'var(--font-body)',
              transition: 'min-height 300ms ease-out',
            },
          }}
          description={
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {showWordCount
                  ? `${wordCount.toLocaleString()}${wordLimit ? ` / ${wordLimit.toLocaleString()}` : ''} words`
                  : maxLength
                    ? `${value.length}/${maxLength.toLocaleString()} characters`
                    : ''}
              </Text>
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={onImportClick}
                style={{ fontFamily: 'var(--font-ui)' }}
              >
                Import from Docs instead
              </Button>
            </Group>
          }
        />
      )}

      {mode === 'preview' && (
        <div className={`content-input-preview${imported ? ' content-input-imported' : ''}`} onClick={imported ? undefined : expand}>
          {imported && (
            <Group gap="xs" mb={4}>
              <span className="content-input-doc-badge">⬡</span>
              <Text size="xs" fw={500} c="dimmed">Imported from Google Docs</Text>
            </Group>
          )}
          <Text size="sm" c="dimmed" lineClamp={3} style={{ fontFamily: 'var(--font-body)', cursor: imported ? 'default' : 'pointer' }}>
            {truncated}
          </Text>
          <Group justify="space-between" mt={4}>
            <Text size="xs" c="dimmed">
              {showWordCount ? `${wordCount.toLocaleString()} words` : `${value.length} characters`}
            </Text>
            <Group gap="xs">
              {imported ? (
                <Button variant="subtle" size="compact-xs" onClick={onImportClick}>Change</Button>
              ) : (
                <Button variant="subtle" size="compact-xs" onClick={expand}>Edit</Button>
              )}
              <Button variant="subtle" size="compact-xs" color="red" onClick={handleClear}>Clear</Button>
            </Group>
          </Group>
        </div>
      )}
    </div>
  );
}
