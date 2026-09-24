// Web already scrolls focused inputs into view; keep server rendering native-free.
import { Fragment } from "react";
export { ScrollView as KeyboardAwareScrollView } from "react-native";
export const KeyboardProvider = Fragment;
