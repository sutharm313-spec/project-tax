// Profile: user card, edit profile, businesses, language, notifications prefs, legal, logout.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { BlurView } from "expo-blur";

import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { useClientApp } from "@/src/app-context";
import { api } from "@/src/api";
import { BrandMark, Button, Card, ChipRow, Icon, Input, Sheet, useToast } from "@/src/ui";
import { makeStyles, radius, spacing } from "@/src/theme";

const LEGAL = {
  privacy: "taxman.manoj stores your identity, tax and document data encrypted in transit and at rest. Documents live in private storage and are only accessible to you and authorized staff. We never sell your data. Documents are viewable/downloadable by you only after payment verification.",
  terms: "By using taxman.manoj you agree to provide accurate information and genuine documents. Service timelines are estimates. Filing obligations depend on correct and timely information from you.",
  refund: "Refunds are available for services not yet started. Once preparation work has begun, fees are non-refundable. Raise a support ticket for any refund or cancellation request.",
};

export default function Profile() {
  const router = useRouter();
  const { user, logout, refreshUser } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const qc = useQueryClient();
  const { businesses, reloadBusinesses, fyList } = useClientApp();
  const [editSheet, setEditSheet] = useState(false);
  const [bizSheet, setBizSheet] = useState(false);
  const [legalSheet, setLegalSheet] = useState<keyof typeof LEGAL | null>(null);
  const [form, setForm] = useState({ name: "", pan: "", address: "", mobile: "" });
  const [bizForm, setBizForm] = useState({ name: "", type: "proprietorship", gstin: "", pan: "" });

  const save = useMutation({
    mutationFn: () => api("/client/profile", { method: "PATCH", body: { ...form, name: form.name || undefined, pan: form.pan || undefined, address: form.address || undefined, mobile: form.mobile || undefined } }),
    onSuccess: async () => {
      setEditSheet(false);
      await refreshUser();
      show("Profile updated", "success");
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not save", "error"),
  });

  const addBiz = useMutation({
    mutationFn: () => api("/client/businesses", { method: "POST", body: bizForm }),
    onSuccess: async () => {
      setBizSheet(false);
      setBizForm({ name: "", type: "proprietorship", gstin: "", pan: "" });
      await reloadBusinesses();
      show("Business added", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not add business", "error"),
  });

  const initials = (user?.name ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24, gap: 16 }} showsVerticalScrollIndicator={false}>
        {/* user card */}
        <Card glass style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={s.avatar}>
              <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 22 }}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 18 }}>{user?.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12.5 }}>{user?.email}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4, alignItems: "center" }}>
                <View style={s.codeBadge} testID="profile-client-code">
                  <Text style={{ color: "#93C5FD", fontWeight: "800", fontSize: 11.5 }}>{user?.client_code}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Tax Consultant</Text>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button label="Edit Profile" icon="create" variant="ghost" onPress={() => { setForm({ name: user?.name ?? "", pan: user?.pan ?? "", address: user?.address ?? "", mobile: user?.mobile ?? "" }); setEditSheet(true); }} testID="profile-edit" style={{ flex: 1 }} />
            <Button label={t("open_whatsapp")} icon="logo-whatsapp" variant="ghost" onPress={() => {}} testID="profile-whatsapp" style={{ flex: 1 }} />
          </View>
        </Card>

        {/* language */}
        <View style={{ gap: 8 }}>
          <Text style={s.section}>{t("language")}</Text>
          <Card>
            <ChipRow
              items={[{ key: "en", label: "English" }, { key: "hi", label: "हिन्दी" }]}
              value={lang}
              onChange={(k) => setLang(k as "en" | "hi")}
              testPrefix="lang"
            />
          </Card>
        </View>

        {/* businesses */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={s.section}>{t("businesses")}</Text>
            <Pressable onPress={() => setBizSheet(true)} testID="profile-add-business"><Text style={{ color: colors.brand, fontWeight: "700", fontSize: 13 }}>+ {t("add_business")}</Text></Pressable>
          </View>
          <View style={{ gap: 10 }}>
            {businesses.map((b) => (
              <Card key={b.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={s.bizIcon}><Icon name="business" size={18} color="#93C5FD" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{b.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11.5 }}>{b.gstin || b.type}</Text>
                </View>
              </Card>
            ))}
            {!businesses.length ? (
              <Card><Text style={{ color: colors.muted, textAlign: "center" }}>No businesses yet</Text></Card>
            ) : null}
          </View>
        </View>

        {/* legal + support */}
        <View style={{ gap: 8 }}>
          <Text style={s.section}>{t("privacy")}</Text>
          <Card style={{ gap: 2 }}>
            {(["privacy", "terms", "refund"] as const).map((k) => (
              <Pressable key={k} onPress={() => setLegalSheet(k)} style={s.row} testID={`legal-${k}`}>
                <Text style={{ color: colors.onSurface, fontWeight: "600", flex: 1 }}>
                  {k === "privacy" ? "Privacy Policy" : k === "terms" ? "Terms & Conditions" : "Refund & Cancellation"}
                </Text>
                <Icon name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            ))}
            <Pressable onPress={() => router.push("/(tabs)/tickets")} style={s.row} testID="profile-support">
              <Text style={{ color: colors.onSurface, fontWeight: "600", flex: 1 }}>{t("help")}</Text>
              <Icon name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          </Card>
        </View>

        <Button label={t("logout")} icon="log-out" variant="danger" onPress={logout} testID="profile-logout" />
        <BrandMark size={18} showTagline />
      </ScrollView>

      {/* edit profile sheet */}
      <Sheet visible={editSheet} onClose={() => setEditSheet(false)} title="Edit Profile">
        <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Input label={t("full_name")} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} testID="edit-name" />
            <Input label={t("mobile")} value={form.mobile} onChangeText={(v) => setForm((f) => ({ ...f, mobile: v }))} keyboardType="phone-pad" testID="edit-mobile" />
            <Input label={t("pan")} value={form.pan} onChangeText={(v) => setForm((f) => ({ ...f, pan: v.toUpperCase().slice(0, 10) }))} testID="edit-pan" placeholder="ABCDE1234F" autoCapitalize="characters" />
            <Input label={t("address")} value={form.address} onChangeText={(v) => setForm((f) => ({ ...f, address: v }))} multiline testID="edit-address" />
            <Button label={t("save")} onPress={() => save.mutate()} loading={save.isPending} testID="edit-save" />
          </View>
        </ScrollView>
      </Sheet>

      {/* add business sheet */}
      <Sheet visible={bizSheet} onClose={() => setBizSheet(false)} title={t("add_business")}>
        <View style={{ gap: 12, paddingBottom: 20 }}>
          <Input label={t("business_name")} value={bizForm.name} onChangeText={(v) => setBizForm((f) => ({ ...f, name: v }))} testID="biz-name" placeholder="ABC Traders" />
          <Input label="Type" value={bizForm.type} onChangeText={(v) => setBizForm((f) => ({ ...f, type: v }))} testID="biz-type" placeholder="proprietorship / partnership" />
          <Input label={t("gstin")} value={bizForm.gstin} onChangeText={(v) => setBizForm((f) => ({ ...f, gstin: v.toUpperCase().slice(0, 15) }))} testID="biz-gstin" placeholder="Optional" autoCapitalize="characters" />
          <Input label={t("pan")} value={bizForm.pan} onChangeText={(v) => setBizForm((f) => ({ ...f, pan: v.toUpperCase().slice(0, 10) }))} testID="biz-pan" placeholder="Optional" autoCapitalize="characters" />
          <Button label={t("save")} onPress={() => addBiz.mutate()} loading={addBiz.isPending} testID="biz-save" />
        </View>
      </Sheet>

      {/* legal sheet */}
      <Sheet visible={!!legalSheet} onClose={() => setLegalSheet(null)} title={legalSheet === "privacy" ? "Privacy Policy" : legalSheet === "terms" ? "Terms & Conditions" : "Refund & Cancellation"}>
        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
          <Text style={{ color: colors.onSurfaceSecondary, lineHeight: 21, paddingBottom: 20 }}>{legalSheet ? LEGAL[legalSheet] : ""}</Text>
        </ScrollView>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  avatar: { width: 60, height: 60, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  codeBadge: { backgroundColor: "rgba(59,130,246,0.15)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(59,130,246,0.4)" },
  section: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 13, minHeight: 44 },
  bizIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
}));
