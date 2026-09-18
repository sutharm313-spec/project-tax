export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

import { Platform } from "react-native";
