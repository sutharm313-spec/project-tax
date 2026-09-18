// Invoices + payments: UPI QR sheet, reference submission, status history.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clipboard, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api, apiForm } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { Button, Card, EmptyState, ErrorState, Icon, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";

type Invoice = { id: string; number: string; service_name: string; description: string; total: number; status: string; date: string; request_id: string | null };
type Payment = { id: string; amount: number; status: string; utr: string | null; created_at: string; rejection_reason?: string };
type Initiate = { payment: { id: string }; upi_uri: string; vpa: string; payee_name: string; qr_base64: string; invoice: Invoice };

export default function Payments() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToast();
  const [tab, setTab] = useState<"invoices" | "history">("invoices");
  const [sheet, setSheet] = useState<Initiate | null>(null);
  const [utr, setUtr] = useState("");
  const [refErr, setRefErr] = useState<string | null>(null);
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const invoices = useQuery<{ invoices: Invoice[] }>({ queryKey: ["invoices"], queryFn: () => api("/client/invoices") });
  const history = useQuery<{ payments: Payment[] }>({ queryKey: ["payments"], queryFn: () => api("/client/payments") });

  const initiate = useMutation({
    mutationFn: (invoice_id: string) => apiForm<Initiate>("/client/payments/initiate", { invoice_id }),
    onSuccess: (data) => {
      setSheet(data);
      setUtr("");
      setRefErr(null);
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not start payment", "error"),
  });

  const submitRef = useMutation({
    mutationFn: (vars: { payment_id: string; utr: string }) => api(`/client/payments/${vars.payment_id}/submit`, { method: "POST", body: { utr: vars.utr } }),
    onSuccess: () => {
      setSheet(null);
      show("Reference submitted — verification usually completes within a few hours", "success");
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e) => setRefErr(e instanceof Error ? e.message : "Invalid reference"),
  });

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.title}>{t("payments")}</Text>
        <View style={s.seg}>
          {(["invoices", "history"] as const).map((k) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[s.segBtn, tab === k && { backgroundColor: colors.brandPrimary }]} testID={`payments-tab-${k}`}>
              <Text style={[s.segText, tab === k && { color: colors.onBrandPrimary }]}>{k === "invoices" ? t("invoices") : t("payment_history")}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomChrome + 24 }} showsVerticalScrollIndicator={false}>
        {tab === "invoices" ? (
          invoices.isError ? (
            <ErrorState message="Could not load invoices" onRetry={() => invoices.refetch()} />
          ) : invoices.isLoading ? (
            <SkeletonList count={3} />
          ) : !invoices.data?.invoices.length ? (
            <EmptyState icon="receipt" title={t("empty_payments")} body={t("empty_payments_body")} testID="payments-empty" />
          ) : (
            <View style={{ gap: 12 }}>
              {invoices.data.invoices.map((inv, i) => (
                <Animated.View key={inv.id} entering={FadeInDown.delay(i * 40).springify().damping(16)}>
                  <Card style={{ gap: 10 }} testID={`invoice-${inv.number}`}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ gap: 2, flex: 1 }}>
                        <Text style={s.invNumber}>{inv.number}</Text>
                        <Text style={s.invService} numberOfLines={1}>{inv.service_name}</Text>
                      </View>
                      <StatusBadge status={inv.status} />
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={s.amount}>₹{inv.total.toLocaleString("en-IN")}</Text>
                      {inv.status === "unpaid" || inv.status === "partial" ? (
                        <Button label={t("pay_now")} icon="logo-google-play" onPress={() => initiate.mutate(inv.id)} loading={initiate.isPending} testID={`pay-${inv.number}`} style={{ minWidth: 150 }} />
                      ) : null}
                    </View>
                  </Card>
                </Animated.View>
              ))}
            </View>
          )
        ) : history.isError ? (
          <ErrorState message="Could not load payments" onRetry={() => history.refetch()} />
        ) : history.isLoading ? (
          <SkeletonList count={3} />
        ) : !history.data?.payments.length ? (
          <EmptyState icon="card" title="No payments yet" body="Payments appear here once you submit a UPI reference." testID="history-empty" />
        ) : (
          <View style={{ gap: 12 }}>
            {history.data.payments.map((p, i) => (
              <Animated.View key={p.id} entering={FadeInDown.delay(i * 40).springify().damping(16)}>
                <Card style={{ gap: 6 }} testID={`payment-${p.id}`}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={s.amount}>₹{p.amount.toLocaleString("en-IN")}</Text>
                    <StatusBadge status={p.status} />
                  </View>
                  <Text style={s.invMeta}>UPI Ref: {p.utr ?? "—"} · {new Date(p.created_at).toLocaleDateString("en-IN")}</Text>
                  {p.status === "submitted" ? <Text style={{ color: colors.warning, fontSize: 12 }}>{t("review_pending")}</Text> : null}
                  {p.status === "rejected" && p.rejection_reason ? <Text style={{ color: colors.error, fontSize: 12 }}>{p.rejection_reason}</Text> : null}
                </Card>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* UPI payment sheet */}
      <Sheet visible={!!sheet} onClose={() => setSheet(null)} title={t("upi_pay")}>
        {sheet ? (
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 560 }}>
            <View style={{ gap: 14, paddingBottom: 24 }}>
              <View style={s.qrWrap} testID="upi-qr">
                <Image source={{ uri: sheet.qr_base64 }} style={{ width: 190, height: 190 }} />
              </View>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 20 }}>₹{sheet.invoice.total.toLocaleString("en-IN")}</Text>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>{sheet.invoice.number} · {sheet.invoice.service_name}</Text>
                <Pressable
                  onPress={async () => {
                    await Clipboard.setString(sheet.vpa);
                    show(t("copied"), "success");
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}
                  testID="copy-vpa"
                >
                  <Text style={{ color: "#93C5FD", fontWeight: "700" }}>{sheet.vpa}</Text>
                  <Icon name="copy" size={14} color="#93C5FD" />
                </Pressable>
              </View>
              <Button
                label="Open UPI app"
                icon="open"
                variant="ghost"
                onPress={() => Linking.openURL(sheet.upi_uri).catch(() => show("Open the link on a phone with a UPI app", "info"))}
                testID="open-upi-app"
              />
              <View style={{ height: 1, backgroundColor: colors.divider }} />
              <Input label={t("upi_ref")} value={utr} onChangeText={(v) => setUtr(v.replace(/\D/g, "").slice(0, 12))} keyboardType="number-pad" placeholder="123456789012" testID="utr-input" />
              {refErr ? <Text style={{ color: colors.error, fontSize: 12, textAlign: "center" }}>{refErr}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>{t("ref_hint")}</Text>
              <Button
                label={t("submit_ref")}
                icon="checkmark-circle"
                loading={submitRef.isPending}
                onPress={() => {
                  if (utr.length !== 12) return setRefErr("UPI reference must be exactly 12 digits");
                  setRefErr(null);
                  submitRef.mutate({ payment_id: sheet.payment.id, utr });
                }}
                testID="submit-utr"
              />
            </View>
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, gap: 14, paddingBottom: 8 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  seg: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: 4, gap: 4 },
  segBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: radius.sm },
  segText: { color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 13 },
  invNumber: { color: colors.onSurface, fontWeight: "800", fontSize: 14.5 },
  invService: { color: colors.muted, fontSize: 12.5 },
  invMeta: { color: colors.muted, fontSize: 12 },
  amount: { color: colors.onSurface, fontWeight: "800", fontSize: 19 },
  qrWrap: { alignSelf: "center", padding: 14, backgroundColor: "#FFFFFF", borderRadius: radius.lg },
}));
