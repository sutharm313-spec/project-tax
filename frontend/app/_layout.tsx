import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useEffect } from "react";
import Icon from "@react-native-vector-icons/ionicons";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth";
import { ClientAppProvider } from "@/src/app-context";
import { I18nProvider } from "@/src/i18n";
import { ToastProvider } from "@/src/ui";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true)

// Prewarm the vector icon font early so the first screen never flashes
// without icons (Expo Go Android asset fix).
function IconPrewarm() {
  return (
    <View style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} pointerEvents="none">
      <Icon name="shield-checkmark" size={12} color="#000" />
    </View>
  );
}

export default function RootLayout() {
  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <AuthProvider>
            <ClientAppProvider>
              <KeyboardProvider>
                <ToastProvider>
                  <Stack screenOptions={{ headerShown: false }} />
                  <IconPrewarm />
                </ToastProvider>
              </KeyboardProvider>
            </ClientAppProvider>
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
