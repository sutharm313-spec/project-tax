// Admin UPI payment console: view UTR, screenshot, client & FY/AY details,
// and manually set status (Payment Received / Under Verification / Not Received).
// Only "Payment Received" unlocks that year's service & documents (server-side).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api, BACKEND } from "@/src/api";
import { Button, Card, ChipRow, DeleteButton, EmptyState, ErrorState, Icon, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Pay = {
  id: string; amount: number; status: string; status_label?: string; utr: string | null; created_at: string;
  rejection_reason?: string; has_screenshot?: boolean;
  history?: { status: string; label?: string; at: string; by_name?: string; note?: string }[];
  client?: { name: string; client_code: string; mobile?: string; email?: string } | null;
  service?: { name: string; fy: string; ay?: string } | null;
};

const FILTERS = [
  { key: "submitted", label: "To Verify" },
  { key: "verified", label: "Received" },
  { key: "rejected", label: "Not Received" },
  { key: "", label: "All" },
];

export default function AdminPayments() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [filter, setFilter] = useState("submitted");
  const [rejectSheet, setRejectSheet] = useState<Pay | null>(null);
  const [historyOf, setHistoryOf] = useState<Pay | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{ payments: Pay[] }>({
    queryKey: ["admin-payments", filter],
    queryFn: () => api(`/admin/payments${filter ? `?status=${filter}` : ""}`),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: string; reason?: string }) => api(`/admin/payments/${vars.id}/status`, { method: "POST", body: { status: vars.status, reason: vars.reason ?? "" } }),
    onSuccess: (res: { status?: string }) => {
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      show(res?.status === "received" ? "Payment received — documents unlocked" : "Status updated", "success");
      setRejectSheet(null);
      setReason("");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Update failed", "error"),
  });

  const viewShot = async (id: string) => {
    try {
      const res = await api<{ file_token: string }>(`/admin/payments/${id}/screenshot`);
      const url = `${BACKEND}/api/gridfiles/${res.file_token}`;
      if (typeof window !== "undefined" && window.open) window.open(url, "_blank");
      else await Linking.openURL(url);
    } catch (e) {
      show(e instanceof Error ? e.message : "No screenshot", "error");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>UPI Payments</Text>
      <View style={{ marginVertical: 8 }}>
        <ChipRow items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} value={filter} onChange={setFilter} testPrefix="pay-filter" />
      </View>

      {isError ? (
        <ErrorState message="Could not load payments" onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonList count={3} />
      ) : !data?.payments.length ? (
        <EmptyState icon="checkmark-circle" title={filter === "submitted" ? "Queue is clear" : "No payments"} body={filter === "submitted" ? "No UPI references waiting for verification." : undefined} testID="admin-payments-empty" />
      ) : (
        <View style={{ gap: 12, paddingBottom: 40 }}>
          {data.payments.map((p, i) => (
            <Animated.View key={p.id} entering={FadeInDown.delay(i * 40).springify().damping(15)}>
              <Card style={{ gap: 10 }} testID={`admin-payment-${p.id}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{p.client?.name} · {p.client?.client_code}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{p.service?.name ?? "—"} · {p.service?.fy ?? ""}{p.service?.ay ? ` · ${p.service.ay}` : ""}</Text>
                    {p.client?.mobile ? <Text style={{ color: colors.muted, fontSize: 11 }}>{p.client.mobile}{p.client.email ? ` · ${p.client.email}` : ""}</Text> : null}
                  </View>
                  <StatusBadge status={p.status} label={p.status_label} />
                  <DeleteButton
                    testID={`delete-payment-${p.id}`}
                    title="Delete this payment?"
                    onConfirm={async () => {
                      await api(`/admin/payments/${p.id}`, { method: "DELETE" });
                      qc.invalidateQueries({ queryKey: ["admin-payments"] });
                      qc.invalidateQueries({ queryKey: ["admin-stats"] });
                      show("Payment deleted", "success");
                    }}
                  />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 19 }}>₹{p.amount.toLocaleString("en-IN")}</Text>
                  <Text style={{ color: "#93C5FD", fontWeight: "700", fontSize: 13 }} testID={`utr-${p.utr ?? "none"}`}>UTR: {p.utr ?? "—"}</Text>
                </View>

                <View style={{ flexDirection: "row", gap: 14 }}>
                  {p.has_screenshot ? (
                    <Pressable onPress={() => viewShot(p.id)} style={{ flexDirection: "row", alignItems: "center", gap: 5 }} testID={`screenshot-${p.id}`}>
                      <Icon name="image" size={15} color={colors.brand} />
                      <Text style={{ color: colors.brand, fontSize: 12.5, fontWeight: "700" }}>View screenshot</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => setHistoryOf(p)} style={{ flexDirection: "row", alignItems: "center", gap: 5 }} testID={`pay-history-${p.id}`}>
                    <Icon name="time" size={15} color={colors.muted} />
                    <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: "700" }}>History ({p.history?.length ?? 0})</Text>
                  </Pressable>
                </View>

                <View style={{ height: 1, backgroundColor: colors.divider }} />
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {p.status !== "verified" ? (
                    <Button label="Payment Received" icon="checkmark-circle" onPress={() => setStatus.mutate({ id: p.id, status: "received" })} loading={setStatus.isPending} testID={`received-${p.id}`} style={{ flex: 1, minWidth: 150 }} />
                  ) : null}
                  {p.status !== "submitted" ? (
                    <Button label="Under Verification" icon="hourglass" variant="soft" onPress={() => setStatus.mutate({ id: p.id, status: "under_verification" })} testID={`underv-${p.id}`} style={{ flex: 1, minWidth: 150 }} />
                  ) : null}
                  {p.status !== "rejected" ? (
                    <Button label="Not Received" icon="close-circle" variant="ghost" onPress={() => setRejectSheet(p)} testID={`notrecv-${p.id}`} style={{ flex: 1, minWidth: 130 }} />
                  ) : null}
                </View>
                {p.status === "rejected" && p.rejection_reason ? <Text style={{ color: colors.error, fontSize: 12 }}>{p.rejection_reason}</Text> : null}
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={!!rejectSheet} onClose={() => setRejectSheet(null)} title="Mark Payment Not Received">
        <View style={{ gap: 12, paddingBottom: 20 }}>
          <Input label="Reason (shared with client)" value={reason} onChangeText={setReason} multiline testID="reject-reason" placeholder="e.g. UPI reference not traceable" />
          <Button label="Confirm — Not Received" variant="danger" icon="close-circle" onPress={() => rejectSheet && setStatus.mutate({ id: rejectSheet.id, status: "not_received", reason })} loading={setStatus.isPending} testID="reject-confirm" />
        </View>
      </Sheet>

      <Sheet visible={!!historyOf} onClose={() => setHistoryOf(null)} title="Payment history">
        <View style={{ gap: 8, paddingBottom: 20 }}>
          {(historyOf?.history ?? []).slice().reverse().map((h, i) => (
            <Card key={i} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{h.label ?? h.status}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>{new Date(h.at).toLocaleString("en-IN")}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11.5 }}>{h.by_name ?? (h.status ? "client" : "")}{h.note ? ` · ${h.note}` : ""}</Text>
            </Card>
          ))}
          {!(historyOf?.history ?? []).length ? <Text style={{ color: colors.muted }}>No history yet</Text> : null}
        </View>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
}));
