import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
initializeApp({ projectId: 'essay-grader-83737x' });
const db = getFirestore();

async function main() {
  const uid = 'R8yiPqSa69ZQl0YqDK2mxb8tPKl1';
  const eid = 'rwOydkfg4dpWJwH25nWy';
  const drafts = await db.collection(`users/${uid}/essays/${eid}/drafts`).orderBy('draftNumber', 'desc').limit(1).get();
  const d = drafts.docs[0];
  const content: string = d.data().content || '';

  // Show all occurrences of 'senatorial' with surrounding context
  let from = 0;
  let count = 0;
  while (true) {
    const idx = content.indexOf('senatorial', from);
    if (idx === -1) break;
    count++;
    const start = Math.max(0, idx - 100);
    const end = Math.min(content.length, idx + 150);
    console.log(`\nOccurrence ${count} at index ${idx}:`);
    console.log(JSON.stringify(content.substring(start, end)));
    // Show char codes around the word for escaping analysis
    const contextStart = Math.max(0, idx - 5);
    const contextEnd = Math.min(content.length, idx + 25);
    const chars = [];
    for (let i = contextStart; i < contextEnd; i++) {
      chars.push(`${content[i]} (${content.charCodeAt(i)})`);
    }
    console.log('Char codes:', chars.join(', '));
    from = idx + 1;
  }

  // General quote analysis
  const doubleQuotes = (content.match(/"/g) || []).length;
  const smartOpenQuotes = (content.match(/\u201c/g) || []).length;
  const smartCloseQuotes = (content.match(/\u201d/g) || []).length;
  console.log(`\nQuote analysis:`);
  console.log(`  Straight double quotes: ${doubleQuotes}`);
  console.log(`  Smart open quotes (\u201c): ${smartOpenQuotes}`);
  console.log(`  Smart close quotes (\u201d): ${smartCloseQuotes}`);

  // Show content length
  console.log(`\nTotal content length: ${content.length} chars`);

  // Compare to test file
  const fs = await import('fs');
  const testContent = fs.readFileSync('test-essays/hayes-letter.txt', 'utf8');
  console.log(`Test file length: ${testContent.length} chars`);
  console.log(`Content matches test file: ${content === testContent}`);

  // Find differences
  if (content !== testContent) {
    for (let i = 0; i < Math.min(content.length, testContent.length); i++) {
      if (content[i] !== testContent[i]) {
        console.log(`\nFirst difference at index ${i}:`);
        console.log(`  Stored:  ${JSON.stringify(content.substring(i, i + 50))}`);
        console.log(`  Test:    ${JSON.stringify(testContent.substring(i, i + 50))}`);
        console.log(`  Stored char: ${content.charCodeAt(i)}`);
        console.log(`  Test char: ${testContent.charCodeAt(i)}`);
        break;
      }
    }
  }
}
main().catch(e => console.error(e));
