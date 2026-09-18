// Payment verification queue: approve/reject UPI references (server-side unlock).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, ErrorState, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Pay = {
  id: string; amount: number; status: string; utr: string | null; created_at: string; rejection_reason?: string;
  client?: { name: string; client_code: string } | null;
  service?: { name: string; fy: string } | null;
};

const FILTERS = [
  { key: "submitted", label: "To Verify" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
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
  const [reason, setReason] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{ payments: Pay[] }>({
    queryKey: ["admin-payments", filter],
    queryFn: () => api(`/admin/payments${filter ? `?status=${filter}` : ""}`),
  });

  const verify = useMutation({
    mutationFn: (vars: { id: string; action: string; reason?: string }) => api(`/admin/payments/${vars.id}/verify`, { method: "POST", body: { action: vars.action, reason: vars.reason ?? "" } }),
    onSuccess: (res: { status?: string }) => {
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      show(res?.status === "verified" ? "Payment verified — documents unlocked" : "Payment rejected", "success");
      setRejectSheet(null);
      setReason("");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Verification failed", "error"),
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Payment Verification</Text>
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
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{p.service?.name ?? "—"} · {p.service?.fy ?? ""}</Text>
                  </View>
                  <StatusBadge status={p.status} />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 19 }}>₹{p.amount.toLocaleString("en-IN")}</Text>
                  <Text style={{ color: "#93C5FD", fontWeight: "700", fontSize: 13 }} testID={`utr-${p.utr ?? "none"}`}>UTR: {p.utr ?? "—"}</Text>
                </View>
                {p.status === "submitted" ? (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Button label="Verify & Unlock" icon="checkmark" onPress={() => verify.mutate({ id: p.id, action: "approve" })} loading={verify.isPending} testID={`verify-${p.id}`} style={{ flex: 1 }} />
                    <Button label="Reject" icon="close" variant="ghost" onPress={() => setRejectSheet(p)} testID={`reject-${p.id}`} style={{ flex: 0.7 }} />
                  </View>
                ) : null}
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={!!rejectSheet} onClose={() => setRejectSheet(null)} title="Reject payment">
        <View style={{ gap: 12, paddingBottom: 20 }}>
          <Input label="Reason (shared with client)" value={reason} onChangeText={setReason} multiline testID="reject-reason" placeholder="e.g. UPI reference not traceable" />
          <Button label="Reject Payment" variant="danger" icon="close-circle" onPress={() => rejectSheet && verify.mutate({ id: rejectSheet.id, action: "reject", reason })} loading={verify.isPending} testID="reject-confirm" />
        </View>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
}));
