import { useEffect, useState } from "react";
import { Alert, Modal, Platform, View, type AlertButton } from "react-native";
import { Btn, Txt } from "./kit";
import { colors } from "./theme";

/**
 * "Are you sure?" dialogs that look the same on iPhone and Android.
 *
 * iOS (and the web shim) keep the native alert. Android's native alert is a Material dialog that looks nothing
 * like the rest of the app, so there <DialogHost> shows the same question in the app's own style.
 */
export type DialogButton = { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void };
type Request = { title: string; message?: string; buttons: DialogButton[] };

let show: ((r: Request) => void) | null = null;

/** Same arguments as Alert.alert. */
export function appAlert(title: string, message?: string, buttons?: DialogButton[]) {
  const list = buttons?.length ? buttons : [{ text: "OK" }];
  if (Platform.OS === "android" && show) {
    show({ title, message, buttons: list });
    return;
  }
  Alert.alert(title, message, list as AlertButton[]);
}

/** Mount once near the root, inside the store provider. Renders nothing except on Android. */
export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  useEffect(() => {
    show = setReq;
    return () => {
      if (show === setReq) show = null;
    };
  }, []);
  if (Platform.OS !== "android") return null;

  const cancel = req?.buttons.find((b) => b.style === "cancel");
  const choose = (b?: DialogButton) => {
    setReq(null);
    b?.onPress?.();
  };
  // Actions first, Cancel last, like a stacked iOS alert. The main action is black.
  const actions = req ? [...req.buttons.filter((b) => b.style !== "cancel"), ...(cancel ? [cancel] : [])] : [];
  const single = actions.length === 1;

  return (
    <Modal visible={!!req} transparent animationType="fade" statusBarTranslucent onRequestClose={() => choose(cancel)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 28 }}>
        {req && (
          <View
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={{ width: "100%", maxWidth: 380, backgroundColor: colors.paper, borderRadius: 24, padding: 22, gap: 10 }}
          >
            <Txt v="h2" center>
              {req.title}
            </Txt>
            {!!req.message && (
              <Txt dim center>
                {req.message}
              </Txt>
            )}
            <View style={{ gap: 10, marginTop: 8 }}>
              {actions.map((b) => (
                <Btn
                  key={b.text}
                  label={b.text}
                  kind={b.style === "cancel" ? "quiet" : single || b.style === "destructive" ? "primary" : "plain"}
                  onPress={() => choose(b)}
                />
              ))}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
