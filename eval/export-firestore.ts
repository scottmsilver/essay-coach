import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const PROJECT_ID = 'essay-grader-83737x';
const OUTPUT_PATH = resolve(dirname(new URL(import.meta.url).pathname), 'datasets/production.json');

interface ExportArgs {
  from?: Date;
  to?: Date;
}

function parseArgs(): ExportArgs {
  const args = process.argv.slice(2);
  const result: ExportArgs = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      result.from = new Date(args[++i] + 'T00:00:00Z');
    } else if (args[i] === '--to' && args[i + 1]) {
      result.to = new Date(args[++i] + 'T23:59:59.999Z');
    } else {
      console.error(`Unknown argument: ${args[i]}`);
      console.error('Usage: npx tsx export-firestore.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
      process.exit(1);
    }
  }
  return result;
}

interface ExportedDraft {
  path: string;
  content: string;
  assignmentPrompt: string;
  writingType: string;
  draftNumber: number;
  previousEvaluation: Record<string, unknown> | null;
  evaluation: Record<string, unknown>;
  grammarAnalysis: Record<string, unknown> | null;
  transitionAnalysis: Record<string, unknown> | null;
  promptAnalysis: Record<string, unknown> | null;
  duplicationAnalysis: Record<string, unknown> | null;
  coachSynthesis: Record<string, unknown> | null;
  submittedAt: string;
}

async function main() {
  const exportArgs = parseArgs();
  initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const db = getFirestore();
  const records: ExportedDraft[] = [];
  const users = await db.collection('users').listDocuments();

  console.log(`Exporting from ${PROJECT_ID}...`);
  if (exportArgs.from) console.log(`  From: ${exportArgs.from.toISOString()}`);
  if (exportArgs.to) console.log(`  To: ${exportArgs.to.toISOString()}`);

  for (const userDoc of users) {
    const essays = await db.collection('users').doc(userDoc.id).collection('essays').get();
    for (const essayDoc of essays.docs) {
      const essayData = essayDoc.data();
      const { assignmentPrompt, writingType } = essayData;
      const drafts = await essayDoc.ref.collection('drafts').get();

      const evalByDraftNumber: Record<number, Record<string, unknown>> = {};
      for (const draftDoc of drafts.docs) {
        const d = draftDoc.data();
        if (d.evaluation && d.draftNumber) {
          evalByDraftNumber[d.draftNumber] = d.evaluation;
        }
      }

      for (const draftDoc of drafts.docs) {
        const draftData = draftDoc.data();
        if (!draftData.evaluation) continue;

        const submittedAt: Timestamp | undefined = draftData.submittedAt;
        if (submittedAt) {
          const ts = submittedAt.toDate();
          if (exportArgs.from && ts < exportArgs.from) continue;
          if (exportArgs.to && ts > exportArgs.to) continue;
        }

        const draftNumber: number = draftData.draftNumber || 1;
        const previousEvaluation = draftNumber > 1
          ? evalByDraftNumber[draftNumber - 1] || null
          : null;

        records.push({
          path: `users/${userDoc.id}/essays/${essayDoc.id}/drafts/${draftDoc.id}`,
          content: draftData.content,
          assignmentPrompt: assignmentPrompt || '',
          writingType: writingType || 'argumentative',
          draftNumber,
          previousEvaluation,
          evaluation: draftData.evaluation,
          grammarAnalysis: draftData.grammarAnalysis || null,
          transitionAnalysis: draftData.transitionAnalysis || null,
          promptAnalysis: draftData.promptAnalysis || null,
          duplicationAnalysis: draftData.duplicationAnalysis || null,
          coachSynthesis: draftData.coachSynthesis || null,
          submittedAt: submittedAt ? submittedAt.toDate().toISOString() : new Date().toISOString(),
        });
      }
    }
  }

  records.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(records, null, 2));

  console.log(`\nExported ${records.length} drafts with evaluations to ${OUTPUT_PATH}`);
  console.log(`  Initial submissions: ${records.filter(r => r.draftNumber === 1).length}`);
  console.log(`  Resubmissions: ${records.filter(r => r.draftNumber > 1).length}`);
  console.log(`  Resubmissions with previous eval: ${records.filter(r => r.previousEvaluation !== null).length}`);
}

main().catch((err) => {
  console.error('Export failed:', err.message || err);
  process.exit(1);
});
