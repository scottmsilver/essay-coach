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

type Step = 'pick' | 'scope' | 'content';

export default function GDocImportDialog({ opened, onClose, onImport, label, initialUrl, initialDocName }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('pick');
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
  const [isEntireDoc, setIsEntireDoc] = useState(false);

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
    setStep('pick');
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
    setIsEntireDoc(false);
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
        setStep('scope');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch document');
    } finally {
      setLoading(false);
    }
  };

  const showContent = (text: string, bm: GDocBookmark[]) => {
    setFullText(text);
    setBookmarks(bm);
    setSections(parseSections(text, bm));
    setSelectedSection(0);
    setStep('content');
  };

  const handleFetchContent = async (id: string, tab: string) => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchGDocInfo(id, tab);
      showContent(data.text, data.bookmarks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tab');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTab = async (tab: string) => {
    setSelectedTab(tab);
    setIsEntireDoc(false);
    await handleFetchContent(docId, tab);
  };

  const handleRefresh = async () => {
    if (!docId) return;
    if (isEntireDoc) {
      await handleFetchEntireDoc();
    } else {
      if (!selectedTab) return;
      await handleFetchContent(docId, selectedTab);
    }
  };

  const doImport = (text: string, sectionIndex: number) => {
    if (!selectedTab) return;
    const trimmed = text.replace(/^[\n ]+/, '').replace(/\s+$/, '');
    onImport(trimmed, { docId, tab: selectedTab, sectionIndex }, url);
    handleClose();
  };

  const handleFetchEntireDoc = async () => {
    setLoading(true);
    setError(null);
    try {
      const allTexts: string[] = [];
      const allBookmarks: GDocBookmark[] = [];
      let offset = 0;
      for (const tab of tabs) {
        const data = await fetchGDocInfo(docId, tab.title);
        allTexts.push(data.text);
        for (const bm of data.bookmarks) {
          allBookmarks.push({ ...bm, offset: bm.offset + offset });
        }
        offset += data.text.length + 2; // +2 for '\n\n' separator
      }
      const combined = allTexts.join('\n\n');
      setSelectedTab(tabs[0].title);
      setIsEntireDoc(true);
      showContent(combined, allBookmarks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch all tabs');
    } finally {
      setLoading(false);
    }
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
  const scopeNoun = multiTab && !isEntireDoc ? 'tab' : 'document';
  const contentLabel = scopeNoun === 'tab' ? `tab "${selectedTab}"` : 'document';

  return (
    <Modal opened={opened} onClose={handleClose} title={`Import ${label} from Google Docs`} size="lg">
      {error && <Alert color="red" mb="md">{error}</Alert>}

      {/* Step 1: Pick a document */}
      {step === 'pick' && (
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

      {/* Step 2: Scope selection (auto-skipped if single tab) */}
      {step === 'scope' && (
        <Stack>
          <Text fw={500}>Select what to import:</Text>
          <Radio.Group value="" onChange={(val) => {
            if (val === '__entire_doc__') {
              handleFetchEntireDoc();
            } else {
              handleSelectTab(val);
            }
          }}>
            <Stack gap="xs">
              <Radio value="__entire_doc__" label={`Entire document (${tabs.length} tabs)`} disabled={loading} />
              {tabs.map((t) => (
                <Radio key={t.id} value={t.title} label={t.title} disabled={loading} />
              ))}
            </Stack>
          </Radio.Group>
          {loading && <Loader size="sm" />}
          <Button variant="subtle" onClick={() => { setStep('pick'); setError(null); }}>
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
            /* --- Has bookmarks: section picker with word counts + entire tab option --- */
            <>
              <Text fw={500}>
                {sections.length} sections found
              </Text>
              <Radio.Group
                value={String(selectedSection)}
                onChange={(val) => setSelectedSection(Number(val))}
              >
                <Stack gap="xs">
                  <Radio
                    value="-1"
                    label={
                      <Text size="sm">
                        <Text span fw={500}>Entire {contentLabel}</Text>
                        <Text span c="dimmed"> ({countWords(fullText).toLocaleString()} words)</Text>
                      </Text>
                    }
                  />
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
              <Button onClick={() => selectedSection === -1 ? doImport(fullText, 0) : doImport(sections[selectedSection], selectedSection)}>
                {selectedSection === -1 ? `Import entire ${contentLabel}` : `Import Section ${selectedSection + 1}`} as {label}
              </Button>
            </>
          ) : (
            /* --- No bookmarks: preview + import entire tab + bookmark tutorial --- */
            <>
              <Text fw={500}>
                {scopeNoun === 'tab' ? `Tab "${selectedTab}" preview` : 'Document preview'}
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
              <Button onClick={() => doImport(fullText, 0)}>
                Import entire {contentLabel} as {label}
              </Button>
              <Accordion variant="subtle">
                <Accordion.Item value="bookmark-tutorial">
                  <Accordion.Control>
                    <Text size="sm" c="dimmed">I only want part of this {scopeNoun}</Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="sm">
                      <Text size="sm">
                        You can split this {scopeNoun} into sections using <strong>Google Docs bookmarks</strong>.
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
              setStep('scope');
            } else {
              setStep('pick');
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
