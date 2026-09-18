// OTP verification (registration + password reset) with resend cooldown.
import { useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { APIError } from "@/src/api";
import { Button, Input, BrandMark, useToast } from "@/src/ui";
import { makeStyles } from "@/src/theme";

export default function Otp() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email: string; purpose?: string; dev_otp?: string }>();
  const { verifyOtp, reset, resendOtp } = useAuth();
  const { t } = useI18n();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const purpose = params.purpose ?? "register";
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (code.length !== 6) return setError("Enter the 6-digit code");
    setBusy(true);
    try {
      if (purpose === "reset") {
        if (password.length < 8) return setError("New password must be at least 8 characters");
        await reset(params.email, code, password);
        show("Password updated. Sign in with your new password.", "success");
        router.replace("/(auth)/login");
      } else {
        await verifyOtp(params.email, code);
        router.replace("/(tabs)");
      }
    } catch (e) {
      setError(e instanceof APIError ? e.message : "Verification failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const res = await resendOtp(params.email);
      show("A new code has been sent to your email", "success");
      if (res?.dev_otp) show(`Preview code: ${res.dev_otp}`, "info");
    } catch (e) {
      show(e instanceof APIError ? e.message : "Could not resend", "error");
    }
  };

  return (
    <LinearGradient colors={["#0A0F1D", "#0D1730"]} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[s.container, { paddingTop: insets.top + 24 }]}>
          <BrandMark size={24} showTagline />
          <Animated.View entering={FadeInDown.springify().damping(16)} style={{ marginTop: 44, gap: 20 }}>
            <View style={{ gap: 6 }}>
              <Text style={s.title}>{purpose === "reset" ? t("reset_password") : t("verify_email")}</Text>
              <Text style={s.subtitle}>
                {t("otp_sent")} {params.email}
              </Text>
            </View>
            <View style={{ gap: 16 }}>
              <Input label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" testID="otp-input" placeholder="000000" />
              {purpose === "reset" ? (
                <Input label="New password" value={password} onChangeText={setPassword} secure testID="otp-new-password" placeholder="Min. 8 characters" />
              ) : null}
              {error ? <Text style={s.error} testID="otp-error">{error}</Text> : null}
              <Button label={purpose === "reset" ? t("reset_password") : t("verify")} onPress={submit} loading={busy} testID="otp-submit" />
              <Button label={t("resend")} onPress={resend} variant="ghost" testID="otp-resend" />
              {purpose === "register" ? (
                <Text onPress={() => router.replace("/(auth)/login")} style={{ color: "#64748B", textAlign: "center" }}>
                  {t("have_account")} <Text style={{ color: "#3B82F6", fontWeight: "800" }}>{t("sign_in")}</Text>
                </Text>
              ) : (
                <Text onPress={() => router.replace("/(auth)/login")} style={{ color: "#64748B", textAlign: "center" }}>
                  {t("back")}
                </Text>
              )}
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, paddingHorizontal: 24, paddingBottom: 24 },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14 },
  error: { color: colors.error, fontSize: 13, textAlign: "center" },
}));
