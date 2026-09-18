// Forgot password: request OTP → /otp?purpose=reset
import { useState } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { APIError } from "@/src/api";
import { Button, Card, Input, BrandMark, useToast } from "@/src/ui";
import { makeStyles } from "@/src/theme";

export default function Forgot() {
  const router = useRouter();
  const { forgot } = useAuth();
  const { t } = useI18n();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await forgot(email.trim().toLowerCase());
      router.push({ pathname: "/(auth)/otp", params: { email: email.trim().toLowerCase(), purpose: "reset", ...(res?.dev_otp ? { dev_otp: res.dev_otp } : {}) } });
      show("Reset code sent to your email", "success");
    } catch (e) {
      show(e instanceof APIError ? e.message : "Could not send code", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={["#0A0F1D", "#0D1730"]} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24 }]}>
          <BrandMark size={24} showTagline />
          <View style={{ marginTop: 44, gap: 20 }}>
            <Text style={s.title}>{t("forgot_password")}</Text>
            <Card style={{ gap: 16 }}>
              <Input label={t("email")} value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" testID="forgot-email" />
              <Button label={t("send_code")} onPress={submit} loading={busy} testID="forgot-submit" />
              <Text onPress={() => router.back()} style={{ color: "#64748B", textAlign: "center" }}>
                {t("back")}
              </Text>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: { paddingHorizontal: 24, paddingBottom: 40 },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
}));
