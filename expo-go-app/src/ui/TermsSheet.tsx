import { useEffect, useState } from "react";
import { Modal, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TERMS, TERMS_VERSION } from "../terms";
import { Btn, Pill, Txt } from "./kit";
import { colors, space } from "./theme";

/** The terms, one section after another. Also used by the Terms of use screen. */
export function TermsBody() {
  return (
    <View style={{ gap: 14 }}>
      {TERMS.map((t) => (
        <View key={t.heading} style={{ gap: 4 }}>
          <Txt bold>{t.heading}</Txt>
          <Txt v="small">{t.body}</Txt>
        </View>
      ))}
      <Txt v="tiny" dim>
        Version {TERMS_VERSION}
      </Txt>
    </View>
  );
}

/**
 * Sign-up terms: a sheet you scroll to the end before "I agree" turns on.
 * If the whole text fits on screen (big tablet), it's on straight away.
 */
export function TermsSheet({ visible, onAgree, onClose }: { visible: boolean; onAgree: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [atEnd, setAtEnd] = useState(false);
  const [boxH, setBoxH] = useState(0);
  const [contentH, setContentH] = useState(0);

  useEffect(() => {
    if (visible) setAtEnd(false);
  }, [visible]);
  useEffect(() => {
    if (boxH > 0 && contentH > 0 && contentH <= boxH + 24) setAtEnd(true);
  }, [boxH, contentH]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) setAtEnd(true);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
        <View
          accessibilityViewIsModal
          style={{ maxHeight: "90%", flexShrink: 1, backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.md) }}
        >
          <View style={{ alignItems: "center", gap: 6, paddingHorizontal: space.md + 4, paddingBottom: space.sm }}>
            <Pill text="Terms of use" />
            <Txt v="small" dim center>
              Please read to the end, then agree to create your account.
            </Txt>
          </View>
          <ScrollView
            style={{ flexShrink: 1, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.faint }}
            contentContainerStyle={{ padding: space.md + 4 }}
            onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}
            onContentSizeChange={(_, h) => setContentH(h)}
            onScroll={onScroll}
            scrollEventThrottle={100}
            accessibilityLabel="Terms of use"
          >
            <TermsBody />
          </ScrollView>
          <View style={{ paddingHorizontal: space.md + 4, paddingTop: space.sm, gap: space.sm }}>
            <Btn kind="primary" icon="check" label={atEnd ? "I agree" : "Scroll to the end to agree"} disabled={!atEnd} onPress={onAgree} />
            <Btn kind="quiet" label="Not now" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
