// Sign in: email/mobile + password. Unverified accounts go to OTP screen.
import { useState } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { APIError } from "@/src/api";
import { Button, Card, Input, BrandMark } from "@/src/ui";
import { makeStyles } from "@/src/theme";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!identifier || !password) {
      setError("Enter your email/mobile and password");
      return;
    }
    setBusy(true);
    try {
      const res = await login(identifier.trim(), password);
      if (res.requiresOtp) router.push({ pathname: "/(auth)/otp", params: { email: res.email ?? identifier, purpose: "register" } });
      else router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof APIError ? e.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={["#0A0F1D", "#0D1730"]} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          <BrandMark size={24} showTagline />
          <Animated.View entering={FadeInDown.springify().damping(16)} style={{ marginTop: 40, gap: 20 }}>
            <View style={{ gap: 6 }}>
              <Text style={s.title}>{t("welcome_back")}</Text>
              <Text style={s.subtitle}>{t("sign_in_sub")}</Text>
            </View>
            <Card style={{ gap: 16 }}>
              <Input label={t("email") + " / " + t("mobile")} value={identifier} onChangeText={setIdentifier} placeholder="you@example.com" testID="login-identifier" keyboardType="email-address" />
              <Input label={t("password")} value={password} onChangeText={setPassword} secure testID="login-password" placeholder="••••••••" />
              {error ? <Text style={s.error} testID="login-error">{error}</Text> : null}
              <Button label={t("sign_in")} onPress={submit} loading={busy} testID="login-submit" />
              <Pressable onPress={() => router.push("/(auth)/forgot")} testID="login-forgot">
                <Text style={{ color: "#93C5FD", textAlign: "center", fontWeight: "600" }}>{t("forgot_password")}</Text>
              </Pressable>
            </Card>
            <View style={{ alignItems: "center", gap: 8 }}>
              <Text style={{ color: "#64748B" }}>{t("no_account")}</Text>
              <Pressable onPress={() => router.push("/(auth)/register")} testID="login-to-register">
                <Text style={{ color: "#3B82F6", fontWeight: "800" }}>{t("sign_up")}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: { paddingHorizontal: 24, flexGrow: 1, justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14.5 },
  error: { color: colors.error, fontSize: 13, textAlign: "center" },
}));
