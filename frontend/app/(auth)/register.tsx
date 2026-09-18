// Registration: name, email, mobile, password → OTP verification.
import { useState } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { APIError } from "@/src/api";
import { Button, Card, Input, BrandMark } from "@/src/ui";
import { makeStyles } from "@/src/theme";

export default function Register() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const [form, setForm] = useState({ name: "", email: "", mobile: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(null);
    if (form.password !== form.confirm) return setError("Passwords do not match");
    if (form.password.length < 8) return setError("Password must be at least 8 characters");
    setBusy(true);
    try {
      await register(form.name.trim(), form.email.trim().toLowerCase(), form.mobile.trim(), form.password);
      router.setParams({});
      router.push({ pathname: "/(auth)/otp", params: { email: form.email.trim().toLowerCase(), purpose: "register" } });
    } catch (e) {
      setError(e instanceof APIError ? e.message : "Could not create account. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={["#0A0F1D", "#0D1730"]} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          <BrandMark size={24} showTagline />
          <Animated.View entering={FadeInDown.springify().damping(16)} style={{ marginTop: 36, gap: 20 }}>
            <View style={{ gap: 6 }}>
              <Text style={s.title}>{t("create_account")}</Text>
              <Text style={s.subtitle}>{t("create_account_sub")}</Text>
            </View>
            <Card style={{ gap: 16 }}>
              <Input label={t("full_name")} value={form.name} onChangeText={set("name")} placeholder="Manoj Suthar" testID="register-name" />
              <Input label={t("email")} value={form.email} onChangeText={set("email")} placeholder="you@example.com" keyboardType="email-address" testID="register-email" />
              <Input label={t("mobile")} value={form.mobile} onChangeText={set("mobile")} placeholder="98765 43210" keyboardType="phone-pad" testID="register-mobile" />
              <Input label={t("password")} value={form.password} onChangeText={set("password")} secure placeholder="Min. 8 characters" testID="register-password" />
              <Input label={t("confirm_password")} value={form.confirm} onChangeText={set("confirm")} secure testID="register-confirm" placeholder="••••••••" />
              {error ? <Text style={s.error} testID="register-error">{error}</Text> : null}
              <Button label={t("sign_up")} onPress={submit} loading={busy} testID="register-submit" />
            </Card>
            <View style={{ alignItems: "center", gap: 8 }}>
              <Text style={{ color: "#64748B" }}>{t("have_account")}</Text>
              <Text onPress={() => router.back()} style={{ color: "#3B82F6", fontWeight: "800" }} testID="register-to-login">
                {t("sign_in")}
              </Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: { paddingHorizontal: 24, paddingBottom: 40 },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14.5 },
  error: { color: colors.error, fontSize: 13, textAlign: "center" },
}));
