import { forwardRef } from "react";
import type { ScrollView, ScrollViewProps } from "react-native";
import { KeyboardAwareScrollView as NativeScroll } from "react-native-keyboard-controller";
export { KeyboardProvider } from "react-native-keyboard-controller";
export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>((props, ref) => <NativeScroll {...props} ref={(instance) => { if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }} bottomOffset={24} disableScrollOnKeyboardHide />);
KeyboardAwareScrollView.displayName = "KeyboardAwareScrollView";
