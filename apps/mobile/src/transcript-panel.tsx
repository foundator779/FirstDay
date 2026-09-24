import type { BeeUtterance } from "@firstday/contracts";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import type { PreviewState, ReviewState } from "./state";
import { countIncludedUtterances, isUtteranceExcluded } from "./review-evidence";

type TranscriptPanelProps = {
  preview: PreviewState;
  review: ReviewState;
  onBack(): void;
  onConsentChange(confirmed: boolean): void;
  onExtract(): void;
  onRetry(): void;
  onToggleUtterance(utterance: BeeUtterance): void;
};

function clockLabel(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function FixturePill() {
  return (
    <View style={styles.fixturePill} accessibilityLabel="Demo fixture, not live Bee data">
      <View style={styles.fixtureDot} />
      <Text style={styles.fixtureText}>DEMO FIXTURE · NOT LIVE BEE</Text>
    </View>
  );
}

function PanelHeader({ onBack }: { onBack(): void }) {
  return (
    <View style={styles.panelHeader}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
      >
        <Text style={styles.backButtonText}>← Sources</Text>
      </Pressable>
      <Text style={styles.folio}>EVIDENCE NOTE · 02</Text>
    </View>
  );
}

function TranscriptRow({
  utterance,
  included,
  onToggle,
}: {
  utterance: BeeUtterance;
  included: boolean;
  onToggle(): void;
}) {
  const speaker = utterance.speaker?.name ?? utterance.speaker?.label ?? "Speaker";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: included }}
      aria-checked={included}
      accessibilityLabel={`${included ? "Included" : "Excluded"}: ${speaker}, ${utterance.text}`}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.utterance,
        !included && styles.utteranceExcluded,
        pressed && styles.utterancePressed,
      ]}
    >
      <View style={[styles.check, included && styles.checkIncluded]}>
        <Text style={[styles.checkText, included && styles.checkTextIncluded]}>
          {included ? "✓" : "–"}
        </Text>
      </View>
      <View style={styles.utteranceCopy}>
        <View style={styles.utteranceMetaRow}>
          <Text style={styles.speaker}>{speaker.toLocaleUpperCase()}</Text>
          <Text style={styles.time}>{clockLabel(utterance.startMs)}</Text>
        </View>
        <Text selectable style={[styles.utteranceText, !included && styles.utteranceTextExcluded]}>
          {utterance.text}
        </Text>
      </View>
      <Text style={[styles.includeLabel, !included && styles.excludeLabel]}>
        {included ? "INCLUDED" : "EXCLUDED"}
      </Text>
    </Pressable>
  );
}

export function TranscriptPanel({
  preview,
  review,
  onBack,
  onConsentChange,
  onExtract,
  onRetry,
  onToggleUtterance,
}: TranscriptPanelProps) {
  if (preview.phase === "loading" || preview.phase === "idle") {
    return (
      <View style={styles.paperCard}>
        <PanelHeader onBack={onBack} />
        <View style={styles.loadingPanel}>
          <ActivityIndicator color={theme.colors.action} />
          <View style={styles.flexCopy}>
            <Text style={styles.stateTitle}>Opening the exact transcript…</Text>
            <Text style={styles.stateBody}>FirstDay is checking the source ID and revision.</Text>
          </View>
        </View>
      </View>
    );
  }

  if (preview.phase === "error" || preview.source === null) {
    return (
      <View style={styles.paperCard}>
        <PanelHeader onBack={onBack} />
        <Text style={styles.title}>That source note did not open.</Text>
        <Text style={styles.body}>{preview.message ?? "FirstDay could not read this source."}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.primaryButtonText}>Try transcript again</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
          >
            <Text style={styles.secondaryButtonText}>Choose another source</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { source } = preview;
  const includedCount = countIncludedUtterances(source.utterances, preview.excludedRanges);

  return (
    <View style={styles.paperCard}>
      <PanelHeader onBack={onBack} />
      <View style={styles.headingRow}>
        <View style={styles.flexCopy}>
          <Text style={styles.kicker}>READ BEFORE YOU CARRY IT FORWARD</Text>
          <Text style={styles.title}>{source.title}</Text>
          <Text style={styles.body}>
            Keep the lines that contain useful first-shift guidance. Excluded lines stay out of
            extraction.
          </Text>
        </View>
        {source.sourceKind === "fixture" && <FixturePill />}
      </View>

      <View style={styles.sourceReceipt}>
        <View>
          <Text style={styles.receiptLabel}>SOURCE ID</Text>
          <Text style={styles.receiptValue} numberOfLines={1}>{source.id}</Text>
        </View>
        <View style={styles.receiptDivider} />
        <View>
          <Text style={styles.receiptLabel}>REVISION</Text>
          <Text style={styles.receiptValue} numberOfLines={1}>{source.revision}</Text>
        </View>
        <View style={styles.receiptDivider} />
        <View>
          <Text style={styles.receiptLabel}>IN REVIEW</Text>
          <Text style={styles.receiptValue}>{includedCount} of {source.utterances.length} lines</Text>
        </View>
      </View>

      <View style={styles.transcriptHeading}>
        <View>
          <Text style={styles.transcriptTitle}>Transcript preview</Text>
          <Text style={styles.transcriptHint}>Tap a line to include or exclude its exact time range.</Text>
        </View>
        <Text style={styles.privateTag}>PRIVATE PREVIEW</Text>
      </View>
      <View style={styles.transcript}>
        {source.utterances.map((utterance) => (
          <TranscriptRow
            key={utterance.id}
            utterance={utterance}
            included={!isUtteranceExcluded(utterance, preview.excludedRanges)}
            onToggle={() => onToggleUtterance(utterance)}
          />
        ))}
      </View>

      <View style={styles.consentCard}>
        <View style={styles.consentTopline}>
          <View style={styles.consentNumber}>
            <Text style={styles.consentNumberText}>✓</Text>
          </View>
          <View style={styles.flexCopy}>
            <Text style={styles.consentTitle}>Permission check</Text>
            <Text style={styles.consentBody}>
              I confirm I have permission to use this conversation for my private FirstDay
              practice.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Confirm permission to use this conversation for private practice"
            value={preview.consentConfirmed}
            onValueChange={onConsentChange}
            trackColor={{ false: theme.colors.rule, true: theme.colors.confirmed }}
            thumbColor={theme.colors.surface}
          />
        </View>
        <View style={styles.privacyRule} />
        <Text style={styles.privacyCopy}>
          The raw transcript is used only inside this source flow. Extracted cards keep exact
          evidence references; they do not hide where a rule came from.
        </Text>
      </View>

      {review.phase === "error" && (
        <View style={styles.errorBanner} accessibilityLiveRegion="polite">
          <Text style={styles.errorTitle}>The review was not created.</Text>
          <Text style={styles.errorBody}>{review.message}</Text>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerNote}>
          {preview.consentConfirmed
            ? `${includedCount} transcript lines will be checked for instructions.`
            : "Confirm permission to continue."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !preview.consentConfirmed || includedCount === 0 }}
          disabled={!preview.consentConfirmed || includedCount === 0}
          onPress={onExtract}
          style={({ pressed }) => [
            styles.continueButton,
            (!preview.consentConfirmed || includedCount === 0) && styles.continueButtonDisabled,
            pressed && styles.primaryButtonPressed,
          ]}
        >
          <Text style={styles.continueButtonText}>Import &amp; find instructions →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  paperCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.rule,
    borderRadius: theme.radius.large,
    borderCurve: "continuous",
    padding: 20,
    boxShadow: Platform.select({
      web: "0 18px 54px rgba(63, 48, 34, 0.10)",
      default: "0 10px 30px rgba(63, 48, 34, 0.10)",
    }),
  },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 22 },
  backButton: { minHeight: theme.control.minimumHeight, justifyContent: "center", paddingHorizontal: 4 },
  backButtonPressed: { opacity: 0.56 },
  backButtonText: { color: theme.colors.action, fontSize: 13, fontWeight: "700" },
  folio: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 18, flexWrap: "wrap" },
  flexCopy: { flex: 1, minWidth: 0 },
  kicker: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  title: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 30, lineHeight: 35, fontWeight: "600", letterSpacing: -0.7 },
  body: { color: theme.colors.secondaryInk, fontSize: 14, lineHeight: 22, marginTop: 8, maxWidth: 660 },
  fixturePill: { minHeight: 28, borderRadius: theme.radius.pill, backgroundColor: theme.colors.infoWash, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  fixtureDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.info },
  fixtureText: { color: theme.colors.info, fontFamily: theme.type.utility, fontSize: 9, fontWeight: "700", letterSpacing: 0.7 },
  sourceReceipt: { backgroundColor: theme.colors.inset, borderRadius: theme.radius.small, padding: 13, marginTop: 20, flexDirection: "row", gap: 13, flexWrap: "wrap", alignItems: "center" },
  receiptLabel: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.7 },
  receiptValue: { color: theme.colors.ink, fontFamily: theme.type.utility, fontSize: 10, marginTop: 3, maxWidth: 220 },
  receiptDivider: { width: 1, height: 30, backgroundColor: theme.colors.rule },
  transcriptHeading: { marginTop: 26, marginBottom: 11, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  transcriptTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 20, fontWeight: "600" },
  transcriptHint: { color: theme.colors.tertiaryInk, fontSize: 12, lineHeight: 17, marginTop: 3 },
  privateTag: { color: theme.colors.confirmed, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", letterSpacing: 0.7 },
  transcript: { borderTopWidth: 1, borderTopColor: theme.colors.rule },
  utterance: { minHeight: 82, borderBottomWidth: 1, borderBottomColor: theme.colors.rule, paddingVertical: 14, paddingHorizontal: 4, flexDirection: "row", alignItems: "flex-start", gap: 11 },
  utteranceExcluded: { opacity: 0.58, backgroundColor: theme.colors.inset },
  utterancePressed: { backgroundColor: theme.colors.actionWash },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.disabledInk, alignItems: "center", justifyContent: "center" },
  checkIncluded: { backgroundColor: theme.colors.confirmed, borderColor: theme.colors.confirmed },
  checkText: { color: theme.colors.tertiaryInk, fontSize: 13, fontWeight: "800" },
  checkTextIncluded: { color: theme.colors.surface },
  utteranceCopy: { flex: 1, minWidth: 0 },
  utteranceMetaRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  speaker: { color: theme.colors.action, fontFamily: theme.type.utility, fontSize: 9, fontWeight: "700", letterSpacing: 0.6 },
  time: { color: theme.colors.tertiaryInk, fontFamily: theme.type.utility, fontSize: 9 },
  utteranceText: { color: theme.colors.ink, fontSize: 14, lineHeight: 21, marginTop: 5 },
  utteranceTextExcluded: { textDecorationLine: "line-through", color: theme.colors.tertiaryInk },
  includeLabel: { color: theme.colors.confirmed, fontFamily: theme.type.utility, fontSize: 8, fontWeight: "700", marginTop: 4 },
  excludeLabel: { color: theme.colors.tertiaryInk },
  consentCard: { backgroundColor: theme.colors.confirmedWash, borderWidth: 1, borderColor: "#C8D0B8", borderRadius: theme.radius.medium, borderCurve: "continuous", padding: 17, marginTop: 24 },
  consentTopline: { flexDirection: "row", alignItems: "center", gap: 12 },
  consentNumber: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.confirmed, alignItems: "center", justifyContent: "center" },
  consentNumberText: { color: theme.colors.surface, fontSize: 15, fontWeight: "800" },
  consentTitle: { color: theme.colors.confirmed, fontFamily: theme.type.display, fontSize: 17, fontWeight: "700" },
  consentBody: { color: theme.colors.ink, fontSize: 13, lineHeight: 19, marginTop: 3 },
  privacyRule: { height: 1, backgroundColor: "#C8D0B8", marginVertical: 13 },
  privacyCopy: { color: theme.colors.secondaryInk, fontSize: 11, lineHeight: 17 },
  errorBanner: { backgroundColor: theme.colors.dangerWash, borderLeftWidth: 3, borderLeftColor: theme.colors.danger, padding: 13, marginTop: 16 },
  errorTitle: { color: theme.colors.danger, fontSize: 13, fontWeight: "800" },
  errorBody: { color: theme.colors.secondaryInk, fontSize: 12, lineHeight: 18, marginTop: 3 },
  footer: { borderTopWidth: 1, borderTopColor: theme.colors.rule, marginTop: 24, paddingTop: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" },
  footerNote: { color: theme.colors.tertiaryInk, fontSize: 12, lineHeight: 18, flex: 1, minWidth: 180 },
  continueButton: { minHeight: 48, borderRadius: theme.radius.small, backgroundColor: theme.colors.action, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  continueButtonDisabled: { backgroundColor: theme.colors.rule },
  continueButtonText: { color: theme.colors.surface, fontSize: 14, fontWeight: "800" },
  primaryButton: { minHeight: theme.control.minimumHeight, borderRadius: theme.radius.small, backgroundColor: theme.colors.action, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  primaryButtonPressed: { backgroundColor: theme.colors.actionPressed, transform: [{ scale: 0.99 }] },
  primaryButtonText: { color: theme.colors.surface, fontSize: 13, fontWeight: "700" },
  secondaryButton: { minHeight: theme.control.minimumHeight, borderRadius: theme.radius.small, borderWidth: 1, borderColor: theme.colors.ink, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  secondaryButtonPressed: { backgroundColor: theme.colors.inset },
  secondaryButtonText: { color: theme.colors.ink, fontSize: 13, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },
  loadingPanel: { minHeight: 180, alignItems: "center", flexDirection: "row", gap: 14 },
  stateTitle: { color: theme.colors.ink, fontFamily: theme.type.display, fontSize: 18, fontWeight: "600" },
  stateBody: { color: theme.colors.secondaryInk, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
