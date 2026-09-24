# FirstDay synthetic demo

## Launch

Use the Node/npm versions declared in `package.json`. In `ProjectB/ProjectB`:

```powershell
npm ci
npm run demo:synthetic
```

Open `http://localhost:8081`. Stop the development server with Ctrl+C.
The launcher forces fixture mode; it does not read Bee credentials. The screen
also offers a live-source option, whose integration is still incomplete.

## Walkthrough

1. Select **Library welcome desk - synthetic training**.
2. Review the transcript. Excluding a line removes it from extraction.
3. Enable permission and select **Import & find instructions**.
4. Confirm the three definite instructions. The uncertain extension policy
   becomes a private question and is not used as an answer key.
5. Select **Start three scenarios**.
6. Enter `I don't know` to exercise retry, then answer with the source action:
   - `record the kit number in the blue ledger`
   - `ask for the collection code before handing it over`
   - `place it in the green repair tray`
7. Open the synthetic policy update and select **Use this synthetic update**.
8. Inspect both source quotes. Select **Confirm change and start drill**.
9. Try the old blue-ledger action. It is no longer correct. Retry with
   `record the kit number in the orange ledger`.

The result is **Updated rule practised**, with both source spans attached. The
prior set is stale and rejects further attempts. **Reset synthetic demo** starts
over, including previously imported sources. Progress also clears on page reload
or app restart. Nothing is saved to Supabase in this mode.

## Other examples

The app includes three training/update pairs: library, art studio, and the
original bookshop. The four additional JSON transcripts live in
`fixtures/transcripts/`. No personal recording or real account data is included.

The new parser extracts one explicit rule per utterance in these forms:

```text
When a guest borrows a display stand, write the stand number on the checkout sheet.
If a guest returns a stained apron, place it in the yellow laundry basket.
Whenever a guest collects a sketch pack, ask for the booking reference.
Update: When a guest borrows a display stand, write the stand number in the checkout notebook.
```

It reads the situation and action from the text. It does not use fixture IDs,
known colors, or stored answer keys for these new transcripts. Statements with
uncertainty markers such as `maybe`, `might`, and `not sure` become questions.
Other grammar is currently ignored; this is not general natural-language
understanding. Updates are explicitly paired with their original source and
must match a confirmed situation. Comparison never silently imports data.

The evaluator accepts the normalized expected action, including capitalization,
ending punctuation, extra spaces, and an optional `I will` or `I would` prefix.
Unknown paraphrases receive **Review the source**. It does not claim to perform
semantic grading. The previous action in a confirmed Change Drill receives a
retry. Input is text-only for now.

## Architecture and verification

`synthetic-client.ts` implements the canonical API-shaped operations locally in
the app. It maintains imports, reviewed instructions, practice sets, attempts,
and confirmed changes within one synthetic session. It is separate from the
server's repository and extractor. `synthetic.ts` contains the bounded parser
and source-driven scenario generation. The earlier bookshop extraction remains
available as its legacy golden fixture.

The tests run the full client flow for all three pairs and additional unseen
transcripts with different IDs and action values. They cover exclusions,
uncertainty, evidence hashes, confirmation, conservative grading, retries,
completion, change lineage, stale attempts, and data-kind separation.

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Browser verification also exercises the actual review, response, retry and
changed-rule UI at desktop and phone widths. This is Expo web validation, not
verification on an iPhone or Apple Watch.

## What still needs real integration

- Authenticate the Bee CLI and retrieve consented device-recorded sources.
- Supply live extraction and generation/evaluation providers; the existing
  server still rejects live extraction.
- Wire durable Supabase persistence and backend comparison/change confirmation.
- Add and test voice input if it remains in the demo scope.
- Verify on the intended phone and record the real Bee interaction for submission.

Synthetic fixtures are a development fallback, not proof of Bee-track eligibility.
