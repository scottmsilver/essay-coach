import { useState } from 'react';
import { Modal, TextInput, Button, Radio, Stack, Text, Loader, Alert } from '@mantine/core';
import { extractDocId, fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
import type { DocSource } from '../../shared/gdocTypes';

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
            Tab: &quot;{selectedTab}&quot; — {sections.length === 1 ? '1 section (no bookmarks)' : `${sections.length} sections`}
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
