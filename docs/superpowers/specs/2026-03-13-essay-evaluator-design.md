# Jago-Style Essay Evaluator — Design Spec

## Overview

A web application where high school students submit essays with assignment prompts and receive structured feedback based on Carol Jago's revision-focused philosophy and the 6+1 Traits writing model. The tool emphasizes guided revision over grading — feedback is prioritized and staged so students know what to fix first and can track improvement across drafts.

## Stack

- **Frontend:** React (Vite)
- **Backend:** Firebase Cloud Functions
- **Database:** Firestore
- **Auth:** Firebase Auth (Google sign-in only)
- **Hosting:** Firebase Hosting
- **AI:** Gemini API (`gemini-3.1-pro-preview`)

## Access Control

Access is restricted to an allowlist of Google accounts stored in Firestore (`config/allowlist`). The Cloud Function checks the authenticated user's email against the allowlist before processing any request. Users not on the list see a "request access" message after sign-in.

**Initial allowlist:**
- user1@example.com
- user2@example.com
- user3@example.com

## Data Model

### Config Collection (`config/allowlist`)

| Field | Type | Description |
|-------|------|-------------|
| `emails` | string[] | List of allowed email addresses |

### Users Collection (`users/{uid}`)

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | From Google account |
| `email` | string | From Google account |
| `createdAt` | timestamp | Account creation time |

### Essays Collection (`users/{uid}/essays/{essayId}`)

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Student-provided title (max 200 chars) |
| `assignmentPrompt` | string | The assignment prompt text (max 2,000 chars) |
| `writingType` | string | One of: argumentative, narrative, expository, persuasive, analytical, informational |
| `createdAt` | timestamp | Essay creation time |
| `updatedAt` | timestamp | Last activity |
| `currentDraftNumber` | number | Tracks latest draft |

### Drafts Subcollection (`users/{uid}/essays/{essayId}/drafts/{draftId}`)

| Field | Type | Description |
|-------|------|-------------|
| `draftNumber` | number | Sequential (1, 2, 3...) |
| `content` | string | The essay text (max 10,000 words) |
| `submittedAt` | timestamp | Submission time |
| `evaluation` | object | Structured Gemini response (see below) |
| `revisionStage` | number \| null | Client-writable. Tracks which revision priority the student is currently focused on in the UI. Updated when student clicks "Start Revising" or switches traits. |

### Evaluation Object Structure

```json
{
  "traits": {
    "ideas": {
      "score": 4,
      "feedback": "Strong central argument about Hamlet's inaction...",
      "revisionPriority": null,
      "annotations": [
        {
          "quotedText": "Hamlet's inability to act is the core of the tragedy",
          "comment": "This is a strong thesis statement — clear and arguable"
        }
      ]
    },
    "organization": {
      "score": 3,
      "feedback": "Thesis is present but buried. Move it to the end of your introduction...",
      "revisionPriority": 2,
      "annotations": [
        {
          "quotedText": "In this essay I will discuss",
          "comment": "This is a weak opening — lead with your argument, not a roadmap"
        }
      ]
    },
    "voice": {
      "score": 5,
      "feedback": "Authentic engagement with the text. Your passion shows...",
      "revisionPriority": null,
      "annotations": []
    },
    "wordChoice": {
      "score": 3,
      "feedback": "Relies on vague words like 'good' and 'things'...",
      "revisionPriority": 3,
      "annotations": [
        {
          "quotedText": "a good play about things",
          "comment": "Replace 'good' and 'things' with specific, descriptive language"
        }
      ]
    },
    "sentenceFluency": {
      "score": 4,
      "feedback": "Good sentence variety. Some paragraphs read smoothly...",
      "revisionPriority": null,
      "annotations": []
    },
    "conventions": {
      "score": 2,
      "feedback": "Multiple run-on sentences. Review comma splice rules...",
      "revisionPriority": 1,
      "annotations": [
        {
          "quotedText": "Hamlet knows he should avenge his father but he keeps thinking about it instead of doing it",
          "comment": "This is a run-on sentence — split it or add a conjunction with a comma"
        }
      ]
    },
    "presentation": {
      "score": 4,
      "feedback": "Paragraphs are well-formed. Consider adding section breaks...",
      "revisionPriority": null,
      "annotations": []
    }
  },
  "overallFeedback": "Your essay shows a strong personal connection to Hamlet...",
  "revisionPlan": [
    "Fix conventions first — focus on run-on sentences and comma splices",
    "Then strengthen organization — move your thesis to the introduction",
    "Then improve word choice — replace vague language with specific terms"
  ],
  "comparisonToPrevious": null
}
```

**Annotations:** Each trait includes an `annotations` array of `{ quotedText, comment }` objects. `quotedText` is a verbatim excerpt from the student's essay. The frontend finds these quoted strings in the essay text to render highlights in the Side-by-Side Revision view. This approach avoids brittle character offsets — if the quoted text appears in the essay, it gets highlighted; if not (e.g., after editing), the highlight gracefully disappears. Gemini is instructed to quote 1-3 representative passages per trait.

**Presentation trait:** In a plain-text context, Presentation evaluates paragraph structure, use of paragraph breaks to separate ideas, and overall formatting intent (e.g., does the student use paragraphs effectively to organize their argument?).

### Comparison Object (drafts 2+)

```json
{
  "scoreChanges": {
    "conventions": { "previous": 2, "current": 4, "delta": 2 },
    "organization": { "previous": 3, "current": 4, "delta": 1 }
  },
  "improvements": [
    "Your comma splices are fixed — sentences now flow correctly",
    "The thesis is now clearly stated in the introduction"
  ],
  "remainingIssues": [
    "Word choice still relies on some vague language in paragraphs 2 and 4"
  ]
}
```

The comparison is generated as part of the same Gemini API call as the evaluation (for drafts 2+). The prompt includes the previous draft's evaluation, and Gemini produces both the new evaluation and the comparison in one response.

## Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own user document
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      // Users can read/write their own essays
      match /essays/{essayId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;

        // Users can read their own drafts; only Cloud Functions (admin SDK) can write evaluations
        match /drafts/{draftId} {
          allow read: if request.auth != null && request.auth.uid == uid;
          // Client can write content, draftNumber, submittedAt, revisionStage
          // Evaluation field is written by Cloud Function via admin SDK (bypasses rules)
          allow create: if request.auth != null && request.auth.uid == uid
                        && !("evaluation" in request.resource.data);
          allow update: if request.auth != null && request.auth.uid == uid
                        && (!("evaluation" in request.resource.data)
                            || (request.resource.data.diff(resource.data).affectedKeys()
                                .hasOnly(["revisionStage"])
                                && (request.resource.data.revisionStage is number
                                    || request.resource.data.revisionStage == null)));
        }
      }
    }

    // Config is admin-only (Cloud Functions via admin SDK)
    match /config/{doc} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

## Cloud Functions

### `submitEssay` (HTTPS Callable) — New essays only

**Input:** `title`, `assignmentPrompt`, `writingType`, `content`

**Process:**
1. Verify user's email is on the allowlist
2. Validate input (title ≤ 200 chars, prompt ≤ 2,000 chars, content ≤ 10,000 words, writingType is a valid enum value)
3. Create the essay document in Firestore
4. Create the first draft document (draftNumber: 1)
5. Call Gemini API with structured JSON output constraint
6. Save evaluation to the draft document via admin SDK
7. Return essayId and evaluation to the client

### `resubmitDraft` (HTTPS Callable) — Drafts 2+

**Input:** `essayId`, `content`

**Process:**
1. Verify user's email is on the allowlist
2. Verify the user owns the essay
3. Validate content (≤ 10,000 words)
4. Retrieve the assignment prompt, writing type, and previous draft's evaluation
5. Create the new draft document, increment `currentDraftNumber`
6. Build Gemini prompt including previous evaluation for comparison
7. Call Gemini API — produces both new evaluation and `comparisonToPrevious` in one response
8. Save evaluation and comparison to the draft document via admin SDK
9. Return evaluation to the client

### `deleteAccount` (Auth trigger)

Recursively deletes all user data from Firestore (user doc, all essays, all drafts) when a Firebase Auth account is deleted. Uses `firestore.recursiveDelete()` from the Admin SDK to handle subcollection cleanup.

### Prompt Engineering

- System prompt defines persona: a supportive but honest writing coach for high school students
- Includes full 6+1 Traits rubric with score descriptors for each level (1-6)
- Instructs Gemini to prioritize actionable, revision-oriented feedback — "tell the student what to do, not just what's wrong"
- For guided revision: instructs Gemini to identify the 2-4 most impactful traits to improve and rank them as a revision plan
- Traits that are already strong (score 4+) get positive reinforcement but no revision priority
- Instructs Gemini to quote 1-3 representative passages per trait for annotations
- For Presentation: instructs Gemini to evaluate paragraph structure and formatting intent
- For drafts 2+: includes previous evaluation and instructs Gemini to generate comparison data
- Output constrained to JSON schema for reliable parsing

### Error Handling

- **Gemini API failure (timeout, rate limit, server error):** Return an error to the client. The draft document is saved with `evaluation: null` so the student's text is not lost. The UI shows an error state with a "Retry" button that re-calls the function.
- **Malformed Gemini response (invalid JSON, missing fields):** Retry once with the same prompt. If still malformed, return an error to the client with the same retry UX.
- **Client-side retry budget:** The "Retry" button allows up to 3 attempts with exponential backoff. After 3 failures, the button is disabled and the student is told to try again later.
- **Content filtered by Gemini:** Return a specific error message to the student explaining that the content could not be evaluated.

## UI Design

### Layout

Top navigation bar with centered, max-width content area. Clean, focused writing tool aesthetic.

**Nav bar:** Logo/app name on left, navigation links center (New Essay, My Essays, Progress), user avatar/sign-out on right.

### Screens

#### 1. Login

Google sign-in button. Minimal branding. If the user signs in but is not on the allowlist, show a message: "You don't have access yet. Contact the administrator."

#### 2. Home (My Essays)

List of essays showing: title, writing type, current draft number, last activity timestamp, status indicator. "New Essay" button prominently placed.

**Empty state:** For new users with no essays, show a welcome message and prominent "Write Your First Essay" CTA.

#### 3. New Essay

Form with:
- Title (text input, max 200 chars)
- Writing type (dropdown: argumentative, narrative, expository, persuasive, analytical, informational)
- Assignment prompt (textarea, max 2,000 chars)
- Essay content (textarea, max 10,000 words)
- Submit button

**Loading state:** After submit, show a loading indicator with a message like "Evaluating your essay..." (evaluation may take 10-30 seconds). The student cannot navigate away without a warning.

#### 4. Trait Grid (Primary Feedback View)

Shown after essay evaluation completes.

- **Revision plan banner** at top — numbered steps with the first priority highlighted (e.g., "1. Conventions → 2. Organization → 3. Word Choice")
- **7 trait cards** in a grid — each shows trait name, score (X/6), and a short feedback summary
- Color-coded by score: red (1-2, needs significant work), yellow (3, developing), green (4-6, strong)
- Click a trait card to expand full feedback inline
- **"Start Revising" button** — enters side-by-side revision view focused on priority 1
- **Draft selector** — dropdown to view previous drafts' evaluations (read-only; "Resubmit" is only available from the latest draft's revision view)

**Error state:** If evaluation failed, show the error with a "Retry" button.

#### 5. Side-by-Side Revision View

- **Left panel:** Essay text in an editable text area. Passages quoted in the selected trait's annotations are highlighted. If a quoted passage can no longer be found (because the student edited it), the highlight gracefully disappears.
- **Right panel:** Detailed feedback for the selected trait, with annotation comments listed. Each comment shows the quoted text it refers to.
- **Trait selector** at top of right panel to switch between traits (highlights update accordingly)
- **"Resubmit" button** — submits the edited essay as a new draft, triggers new evaluation
- Student can skip ahead in the revision plan — guidance, not a locked sequence
- **Autosave:** Essay edits are saved to a local draft in the browser (localStorage) to prevent losing work on accidental navigation. A "you have unsaved changes" warning appears if the student tries to navigate away.

#### 6. Draft Comparison

Shown after resubmission (draft 2+). Overlays on the Trait Grid view:
- Score deltas per trait (e.g., "Conventions: 2 → 4 ↑")
- Improvement callouts ("Your thesis is now clearer because...")
- Updated revision plan for remaining issues

#### 7. Progress

Long-term view across all essays:
- Trait scores over time (simple line or bar charts per trait)
- Each data point labeled with essay title and draft number for context
- Identifies consistent strengths and areas for growth
- Note: scores across different writing types are not directly comparable, but the chart shows overall trends

### Intentionally Excluded

- No teacher/admin view
- No peer review
- No essay sharing
- No AI chat/conversation — feedback is structured, not conversational
- No plagiarism detection

## Scoring

- 6-point scale per trait (standard for 6+1 Traits model)
- Scores are available but secondary — feedback and revision guidance are front and center
- Scores shown on trait cards and in draft comparisons
- No composite/overall score — each trait evaluated independently

## Revision Philosophy

Following Carol Jago's approach:
- **Revision over correction** — feedback tells students what to do, not just what's wrong
- **Prioritized and staged** — don't overwhelm with everything at once; focus on the most impactful improvements first
- **Supportive tone** — positive reinforcement for strengths alongside actionable guidance for weaknesses
- **Student agency** — the revision plan is guidance, not a requirement; students can skip ahead or resubmit at any time
- **Progress tracking** — students can see their growth across drafts and across essays
