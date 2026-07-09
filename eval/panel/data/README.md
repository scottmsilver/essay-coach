# Grammar-calibration data

Drop gold-labeled grammar-error-correction (GEC) datasets here to feed
`eval/panel/grammar-calibration.ts`.

## Where to get samples

- **BEA-2019 shared task** (W&I+LOCNESS dev set) —
  https://www.cl.cam.ac.uk/research/nl/bea2019st/ — the standard GEC
  benchmark; use the dev split so gold labels are public (test-set gold is
  withheld for the shared task's own leaderboard).
- **JFLEG dev** — https://github.com/keisks/jfleg — fluency-oriented GEC
  corpus, good complement to BEA-2019 since it corrects for fluency/naturalness
  rather than only strict grammaticality.

Both are released for research use; check each dataset's license before
redistributing derived files outside this repo.

## Expected JSON shape

```json
{
  "sentences": [
    { "id": "s1", "text": "He go to school every day." }
  ],
  "gold": {
    "s1": [{ "start": 3, "end": 5, "replacement": "goes" }]
  }
}
```

- `sentences[].id` keys into `gold`.
- `gold[id]` is a list of `Edit` objects: `{ start, end, replacement }`, where
  `start`/`end` are **character offsets into `sentences[].text`** (not token
  or word indices) and `replacement` is the corrected text for that span.

## Matching caveat (v1)

`scoreModelAgainstGold` (and the underlying `scoreEdits` in `../errant.ts`)
matches edits by **exact span equality** — a system edit only counts as a true
positive if its `start`, `end`, and `replacement` are all identical to a gold
edit. This is a simplified stand-in for full ERRANT-style alignment, which
would tokenize, align edits that overlap but don't match exactly (e.g.
differing span boundaries around the same correction), and classify error
types. Treat scores here as directionally useful for comparing models against
each other, not as calibrated absolute GEC metrics — revisit with real ERRANT
alignment before using this to make external claims about model quality.
