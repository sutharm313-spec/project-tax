// Settings: business profile, UPI, payment prefs, audit trail, reports export.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, ErrorState, Input, SectionHeader, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Settings = {
  business: { name: string; legal_name: string; phone: string; email: string; address: string };
  upi: { vpa: string; payee_name: string };
  allow_partial_payments: boolean;
  whatsapp_number: string;
  expiry_reminder_days: number;
};

const REPORTS = ["clients", "revenue", "services", "pending_documents", "deadlines", "tickets"];

export default function AdminSettings() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [form, setForm] = useState<Settings | null>(null);
  const [vpa, setVpa] = useState("");

  const settings = useQuery<{ settings: Settings }>({
    queryKey: ["admin-settings"],
    queryFn: () => api("/admin/settings"),
  });

  const audit = useQuery<{ logs: { id: string; actor_id: string; actor_role: string; action: string; target: string; details: Record<string, unknown>; created_at: string }[] }>({
    queryKey: ["admin-audit"],
    queryFn: () => api("/admin/audit?limit=50"),
  });

  if (settings.data?.settings && !form) {
    setForm(settings.data.settings);
    setVpa(settings.data.settings.upi?.vpa ?? "");
  }

  const save = useMutation({
    mutationFn: () => api("/admin/settings", { method: "PUT", body: { ...(form ?? {}), upi: { ...(form?.upi ?? {}), vpa: vpa } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      show("Settings saved", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not save", "error"),
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Settings</Text>

      {settings.isLoading || !form ? (
        <View style={{ marginTop: 12 }}><SkeletonList count={2} /></View>
      ) : (
        <View style={{ gap: 14, marginTop: 12, paddingBottom: 40 }}>
          <Card style={{ gap: 12 }}>
            <Text style={s.section}>Business Profile</Text>
            <Input label="Brand name" value={form.business.name} onChangeText={(v) => setForm((f) => (f ? { ...f, business: { ...f.business, name: v } } : f))} testID="settings-brand" />
            <Input label="Legal name" value={form.business.legal_name} onChangeText={(v) => setForm((f) => (f ? { ...f, business: { ...f.business, legal_name: v } } : f))} testID="settings-legal" />
            <Input label="Phone" value={form.business.phone} onChangeText={(v) => setForm((f) => (f ? { ...f, business: { ...f.business, phone: v } } : f))} testID="settings-phone" />
            <Input label="Email" value={form.business.email} onChangeText={(v) => setForm((f) => (f ? { ...f, business: { ...f.business, email: v } } : f))} testID="settings-email" />
            <Input label="Address" value={form.business.address} onChangeText={(v) => setForm((f) => (f ? { ...f, business: { ...f.business, address: v } } : f))} multiline testID="settings-address" />
          </Card>

          <Card style={{ gap: 12 }}>
            <Text style={s.section}>UPI Payments</Text>
            <Input label="UPI ID (VPA)" value={vpa} onChangeText={(v) => setVpa(v)} placeholder="yourname@upi" testID="settings-vpa" />
            <Input label="Payee name" value={form.upi.payee_name} onChangeText={(v2) => setForm((f) => (f ? { ...f, upi: { ...f.upi, payee_name: v2 } } : f))} testID="settings-payee" />
            <Pressable
              onPress={() => setForm((f) => (f ? { ...f, allow_partial_payments: !f.allow_partial_payments } : f))}
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              testID="settings-partial"
            >
              <View style={[s.checkbox, form.allow_partial_payments && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                {form.allow_partial_payments ? <Text style={{ color: "#FFF", fontSize: 12 }}>✓</Text> : null}
              </View>
              <Text style={{ color: colors.onSurface, fontWeight: "600" }}>Allow partial payments</Text>
            </Pressable>
            <Input label="WhatsApp number (for deep-link messages)" value={form.whatsapp_number} onChangeText={(v) => setForm((f) => (f ? { ...f, whatsapp_number: v } : f))} testID="settings-whatsapp" />
            <Button label="Save Settings" icon="save" onPress={() => save.mutate()} loading={save.isPending} testID="settings-save" />
          </Card>

          <SectionHeader title="Reports Export (CSV)" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {REPORTS.map((r) => (
              <Pressable key={r} onPress={() => window.open(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/admin/reports/${r}`, "_blank")} style={s.reportBtn} testID={`report-${r}`}>
                <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12, textTransform: "capitalize" }}>{r.replace(/_/g, " ")}</Text>
              </Pressable>
            ))}
          </View>

          <SectionHeader title="Audit Trail" />
          <Card style={{ gap: 10 }}>
            {audit.isLoading ? <SkeletonList count={2} /> : null}
            {(audit.data?.logs ?? []).slice(0, 20).map((l) => (
              <View key={l.id} style={{ gap: 2 }}>
                <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 12.5, textTransform: "capitalize" }}>{l.action.replace(/_/g, " ")}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>{l.actor_role} → {l.target} · {new Date(l.created_at).toLocaleString("en-IN")}</Text>
              </View>
            ))}
            {!audit.isLoading && !audit.data?.logs.length ? <Text style={{ color: colors.muted }}>No audit entries yet</Text> : null}
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  section: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  reportBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, flexShrink: 0 },
}));
