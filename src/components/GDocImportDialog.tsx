import { useState, useEffect, useRef } from 'react';
import {
  Modal, Button, Radio, Stack, Text, Loader, Alert,
  Group, Accordion, ScrollArea, Box,
} from '@mantine/core';
import { extractDocId, fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
import { countWords } from '../utils';
import type { DocSource, GDocBookmark } from '../../shared/gdocTypes';
import { openGooglePicker } from '../utils/googlePicker';
import { useAuth } from '../hooks/useAuth';

interface Props {
  opened: boolean;
  onClose: () => void;
  onImport: (text: string, source: DocSource, url: string) => void;
  label: string; // "essay" or "prompt"
  initialUrl?: string;
  initialDocName?: string;
}

type Step = 'url' | 'tab' | 'content';

export default function GDocImportDialog({ opened, onClose, onImport, label, initialUrl, initialDocName }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [docName, setDocName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // Data from web app
  const [docId, setDocId] = useState('');
  const [tabs, setTabs] = useState<Array<{ title: string; id: string }>>([]);
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [fullText, setFullText] = useState('');
  const [bookmarks, setBookmarks] = useState<GDocBookmark[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [selectedSection, setSelectedSection] = useState<number>(0);

  // Pre-fill URL from prop when dialog opens, and auto-fetch if URL is provided
  const autoFetchedRef = useRef('');
  useEffect(() => {
    if (opened && initialUrl) {
      setUrl(initialUrl);
      if (initialDocName) setDocName(initialDocName);
      // Auto-fetch if this is a new URL we haven't fetched yet
      if (initialUrl !== autoFetchedRef.current) {
        autoFetchedRef.current = initialUrl;
        handleFetchTabs(initialUrl);
      }
    }
  }, [opened, initialUrl, initialDocName]);

  const reset = () => {
    setStep('url');
    setUrl(initialUrl ?? '');
    setDocName(initialDocName ?? '');
    setLoading(false);
    setError(null);
    setPickerError(null);
    autoFetchedRef.current = '';
    setDocId('');
    setTabs([]);
    setSelectedTab(null);
    setFullText('');
    setBookmarks([]);
    setSections([]);
    setSelectedSection(0);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFetchTabs = async (inputUrl?: string) => {
    const target = inputUrl ?? url;
    setError(null);
    setLoading(true);
    try {
      const id = extractDocId(target);
      setDocId(id);
      const data = await fetchGDocInfo(id);
      setTabs(data.tabs);
      if (data.tabs.length === 1) {
        setSelectedTab(data.tabs[0].title);
        await handleFetchContent(id, data.tabs[0].title);
      } else {
        setStep('tab');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch document');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchContent = async (id: string, tab: string) => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchGDocInfo(id, tab);
      setFullText(data.text);
      setBookmarks(data.bookmarks);
      const parsed = parseSections(data.text, data.bookmarks);
      setSections(parsed);
      setSelectedSection(0);
      setStep('content');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tab');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTab = async (tab: string) => {
    setSelectedTab(tab);
    await handleFetchContent(docId, tab);
  };

  const handleRefresh = async () => {
    if (!docId || !selectedTab) return;
    await handleFetchContent(docId, selectedTab);
  };

  const handleImportSection = (sectionIndex: number) => {
    if (!selectedTab || sections.length === 0) return;
    const source: DocSource = {
      docId,
      tab: selectedTab,
      sectionIndex,
    };
    onImport(sections[sectionIndex], source, url);
    handleClose();
  };

  const handleImportEntireTab = () => {
    if (!selectedTab) return;
    const trimmed = fullText.replace(/^[\n ]+/, '').replace(/\s+$/, '');
    const source: DocSource = {
      docId,
      tab: selectedTab,
      sectionIndex: 0,
    };
    onImport(trimmed, source, url);
    handleClose();
  };

  const handlePicker = async () => {
    setPickerError(null);
    try {
      const result = await openGooglePicker(user?.email ?? undefined);
      if (!result) return; // user cancelled
      setUrl(result.url);
      setDocName(result.name);
      await handleFetchTabs(result.url);
    } catch (err) {
      setPickerError(
        err instanceof Error ? err.message : 'Google Picker unavailable'
      );
    }
  };

  const hasBookmarks = bookmarks.length > 0;
  const multiTab = tabs.length > 1;
  const contentLabel = multiTab ? `tab "${selectedTab}"` : 'document';

  return (
    <Modal opened={opened} onClose={handleClose} title={`Import ${label} from Google Docs`} size="lg">
      {error && <Alert color="red" mb="md">{error}</Alert>}

      {/* Step 1: Pick a document */}
      {step === 'url' && (
        <Stack>
          {loading ? (
            <Group gap="sm" align="center">
              <Loader size="sm" />
              <div>
                {docName ? (
                  <Group gap="xs">
                    <Text size="lg">📄</Text>
                    <div>
                      <Text size="sm" fw={600}>{docName}</Text>
                      <Text size="xs" c="dimmed">Loading document...</Text>
                    </div>
                  </Group>
                ) : (
                  <Text size="sm" c="dimmed">Loading document...</Text>
                )}
              </div>
            </Group>
          ) : (
            <>
              <Button
                variant="light"
                onClick={handlePicker}
                leftSection={<span>📄</span>}
              >
                Browse Google Docs
              </Button>
              {pickerError && (
                <Alert color="yellow" variant="light">
                  {pickerError}
                </Alert>
              )}
            </>
          )}
        </Stack>
      )}

      {/* Step 2: Tab selection (auto-skipped if single tab) */}
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

      {/* Step 3: Content — two sub-modes based on bookmarks */}
      {step === 'content' && (
        <Stack>
          {sections.length === 0 ? (
            <Alert color="yellow">This document has no text content. Try a different tab or URL.</Alert>
          ) : hasBookmarks ? (
            /* --- Has bookmarks: section picker with word counts --- */
            <>
              <Text fw={500}>
                {sections.length} sections found
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
                          <Text span fw={500}>Section {i + 1}</Text>
                          <Text span c="dimmed"> ({countWords(s).toLocaleString()} words)</Text>
                          <Text span c="dimmed"> — </Text>
                          {preview(s)}
                        </Text>
                      }
                    />
                  ))}
                </Stack>
              </Radio.Group>
              <Button onClick={() => handleImportSection(selectedSection)}>
                Import Section {selectedSection + 1} as {label}
              </Button>
            </>
          ) : (
            /* --- No bookmarks: preview + import entire tab + bookmark tutorial --- */
            <>
              <Text fw={500}>
                {multiTab ? `Tab "${selectedTab}" preview` : 'Document preview'}
                <Text span c="dimmed" fw={400}> ({countWords(fullText).toLocaleString()} words)</Text>
              </Text>
              <ScrollArea h={200} type="auto">
                <Box
                  p="sm"
                  style={{
                    backgroundColor: 'var(--mantine-color-gray-0)',
                    borderRadius: 'var(--mantine-radius-sm)',
                    fontFamily: '"Source Sans 3", sans-serif',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {fullText}
                </Box>
              </ScrollArea>
              <Button onClick={handleImportEntireTab}>
                Import entire {contentLabel} as {label}
              </Button>
              <Accordion variant="subtle">
                <Accordion.Item value="bookmark-tutorial">
                  <Accordion.Control>
                    <Text size="sm" c="dimmed">I only want part of this {multiTab ? 'tab' : 'document'}</Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="sm">
                      <Text size="sm">
                        You can split this {multiTab ? 'tab' : 'document'} into sections using <strong>Google Docs bookmarks</strong>.
                        Place a bookmark where you want each section to start:
                      </Text>
                      <Box
                        p="sm"
                        style={{
                          backgroundColor: 'var(--mantine-color-gray-0)',
                          borderRadius: 'var(--mantine-radius-sm)',
                        }}
                      >
                        <Text size="sm" component="ol" style={{ margin: 0, paddingLeft: 20 }}>
                          <li>Open your document in Google Docs</li>
                          <li>Click where you want a section break</li>
                          <li>Go to <strong>Insert &rarr; Bookmark</strong></li>
                          <li>Repeat for each section boundary</li>
                          <li>Come back here and click <strong>Refresh</strong></li>
                        </Text>
                      </Box>
                      <Group>
                        <Button
                          variant="light"
                          size="sm"
                          component="a"
                          href={`https://docs.google.com/document/d/${docId}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open in Google Docs
                        </Button>
                        <Button
                          variant="light"
                          size="sm"
                          onClick={handleRefresh}
                          loading={loading}
                        >
                          Refresh
                        </Button>
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </>
          )}
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

function preview(text: string, maxLen = 120): string {
  const clean = text.replace(/\n+/g, ' ').trim();
  return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
}
