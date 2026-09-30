# Figma layout and iOS validation

## September 30 update

The sections below retain the earlier dated checks. Physical fictional
practice/retry/recap and Change Drill subsequently passed; the user directly
verified Start/Stop speaking, live/final transcript and Check answer without
errors. The latest custom Release builds and installs on the paired phone;
opening that installation is pending device unlock.

The latest Simulator Release keeps fixed headers, source selectors, progress
circles/captions and all four navigation labels readable at the largest
accessibility text size. Ordinary content remains scalable and scrollable.
Permission switches retain their width, and actual software-keyboard typing
and drag dismissal passed in the understanding screen. This does not establish
a complete VoiceOver pass. See [current live validation](live-demo.md) and
`TASKS.md` for pending physical/live gates.

## Implementation

The existing Expo React Native iOS app adapts the user-supplied
[Figma medical app kit](https://www.figma.com/design/r77BdScud0c2zezb2VVvSQ?node-id=37-626).
Reference frames and screenshots were inspected before implementation.

| Reference | FirstDay adaptation |
| --- | --- |
| Home, 37:626 | Greeting, searchable training list, lavender session cards and blue bottom navigation |
| Message, 14:453 | Character header, situation message, answer composer and evidence feedback |
| Complete appointments, 18:47 | Practice recap cards with actual actions and attempt counts |

League Spartan is bundled locally. Icons use exact exported SVGs, attributed in
`apps/mobile/assets/figma/README.md`. FirstDay's original character art and
training content replace the medical content.

Training, Questions, About and Practice tabs retain the mounted review/practice
flow, including consent, exclusions, instruction edits and answer drafts.
Source consent, private questions, human confirmation, evidence and changed-rule
semantics remain connected to the existing API.

## Recorded checks — September 15, 2026

- All 404 automated tests passed, including search matching and empty results.
- Workspace typecheck, build and lint passed. Mobile typecheck and lint passed
  after final accessibility adjustments.
- Web and iOS Hermes exports passed. These verify bundling, not an installed
  native app or a signed IPA.
- Browser Home visual review covered the 360 × 800 reference layout. Opaque
  PNG icon backgrounds found during review were fixed using original SVGs.
- Browser search/filter, empty results and clearing search worked.
- Live Nova Pro browser test covered consent, an excluded passage, extraction,
  the private uncertainty question, edited instruction confirmation, three
  scenarios, a rejected wrong ledger, successful paraphrased retry and recap.
  The recap showed two attempts for the retried action and one for the others.
- Tab switching preserved consent/exclusion, an instruction edit and an answer
  draft. Selected tabs and checked items expose their web accessibility state
  alongside native accessibility props.
- Final offline browser walkthrough completed three scenarios, update comparison,
  confirmation, stale earlier practice, one Change Drill and the updated recap.
  Both earlier and updated source quotes appeared in feedback.
- `npm run demo:ios` started the LAN Metro preview on port 8084.
- A scoped scan found no configured Bedrock credential in repository/exported
  files. Mobile launchers strip backend credentials.

Later web screenshot captures timed out in the browser automation tool; final
web recap and update checks used the live accessibility tree. Native checks
below were subsequently performed on Appetize; no physical iPhone or VoiceOver
result is claimed.

## Appetize native smoke test — September 15, 2026

- EAS Release simulator build `1413bc04-5b29-4b00-a73f-9068900e804b`
  completed successfully using fixture data and offline grading. No credential
  files or key-pattern matches were found in the checked source archive.
- User uploaded the compressed `FirstDay.app` to Appetize Free. The app ran on
  an iPhone 14 Pro simulator with iOS 17.2 across three bounded sessions.
- Native home showed the bundled font, blue/lavender palette, original
  character art, training cards and bottom navigation. Header and navigation
  stayed inside the visible notch/home-indicator areas in portrait.
- Library selection, transcript scrolling, permission gate, local extraction
  and all three instruction confirmations worked.
- The tentative extension statement became an Ask your trainer question,
  separate from the three confirmed practice instructions.
- Practice launched with Rowan and the reading-kit situation. Native keyboard
  events entered `record the kit number in the blue ledger`; submission showed
  successful coverage and the supporting quote at 0:08–0:16.
- No crash was observed on that path. This is an offline native smoke test,
  not verification of live Bee or native Bedrock networking.

### Finding and remaining checks

Opening the software keyboard from the initial practice screen can leave the
focused composer below the visible scroll area. A manual upward drag reveals
the composer and dismisses the keyboard; its focus/scroll behavior needs a fix
and another native check. The home card's "3 situations" label also renders
small compared with its adjacent explanatory text.

Appetize ended each full session at the Free plan's three-minute limit. The
app's temporary state resets between sessions. Native wrong-answer/retry,
three-scenario recap, Change Drill, edit/draft retention, large text and
VoiceOver are still unverified. Existing web/API results above do not replace
these native checks. Streaming was stopped by returning to the Apps dashboard;
the uploaded build remains available in the account.

## Open the native preview

### Keyboard and spoken rehearsal update — September 15, 2026

- Replaced native keyboard avoidance with a keyboard-aware scrolling container
  backed by `react-native-keyboard-controller`; focused editors should remain
  above the keyboard. Web keeps its standard scroll container.
- Added exact scenario playback, explicit microphone start/stop/cancel,
  a 60-second recording limit, editable transcript review and typed fallback.
  Only stopped recognition is eligible for submission. Permission denial,
  errors, silence and cancellation preserve the previous answer. Navigation and
  backgrounding stop audio. Native permission prompts contain FirstDay's purpose.
- Ten controller tests cover permission, cancellation/races, timeout, failure,
  silence and finalized transcripts. Two additional integration cases verify
  voice/text grading parity and source evidence. All 416 tests pass.
- Typecheck, lint, workspace build and iOS/web Metro export pass. Browser smoke
  test entered a draft, started/canceled speech, verified the draft remained,
  and submitted it for correct feedback plus the source quote/time. Tab navigation
  also canceled recording and preserved the draft. Wrong-answer feedback, retry,
  all three situations, recap and source comparison/Change Drill launch passed.
- EAS simulator build `13550337-5c3b-42f5-844a-38b15ff35acd` finished successfully
  (build number 2). Downloaded to
  `test-results/iphone/FirstDay-voice-keyboard-build2.tar.gz`. Chrome rejected
  automatic file upload with `Not allowed`; Appetize upload dialog is open for
  manual upload or browser file-URL permission. Native retest is pending; do not
  treat code-level checks or browser rendering as proof of the keyboard fix.
- Appetize explicitly does not support microphone input on any platform or
  iOS audio output. Actual recognition quality/playback require a physical
  device/custom build or a supported browser with a human speaker. No actual
  voice transcription or audible iOS playback result is claimed yet.
  Source: https://support.appetize.io/does-appetize.io-support-audio-including-sound-or-microphone

### Development preview

From the repository root:

```sh
npm ci
npm run demo:ios
```

Open the printed Expo QR code using a compatible Expo Go app on an iPhone on the
same Wi-Fi network. This launcher uses fictional examples and offline grading;
no API key belongs on the phone. The web Bedrock preview remains
`npm run demo:bedrock` at `http://localhost:8083`.

Speech recognition requires the custom native build; Expo Go uses the typed
fallback because it does not contain the speech recognition module.

On a Mac, use Expo's iOS workflow to generate/build the native project. This
Windows machine has no local Xcode or iOS simulator; the EAS/Appetize route above
provides cloud build and simulator access. Further device testing must check
keyboard focus after the identified fix, large text and VoiceOver focus.
Signing/TestFlight have not been configured.

Demo storage remains temporary. Offline reload resets progress; replaying the
same source after a Bedrock page reload requires restarting `demo:bedrock`.
Durable recovery is tracked in DB-002. Real Bee recording verification remains
under BEE-001/TEST-001.
