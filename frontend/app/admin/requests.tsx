// All service requests: status pipeline, staff assignment, acknowledgement numbers.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, DeleteButton, EmptyState, ErrorState, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Req = {
  id: string; service_name: string; fy: string; status: string; payment_status: string; price: number;
  client?: { id: string; name: string; client_code: string } | null;
  assigned_staff_id?: string | null;
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "payment_pending", label: "Unpaid" },
  { key: "payment_submitted", label: "To Verify" },
  { key: "in_progress", label: "In Progress" },
  { key: "under_review", label: "Review" },
  { key: "completed", label: "Done" },
];

const STATUSES = ["active", "in_progress", "under_review", "waiting_info", "completed", "cancelled"];

export default function AdminRequests() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [filter, setFilter] = useState("");
  const [manage, setManage] = useState<Req | null>(null);
  const [ack, setAck] = useState("");
  const [filingDate, setFilingDate] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{ requests: Req[] }>({
    queryKey: ["admin-requests", filter],
    queryFn: () => api(`/admin/requests${filter ? `?status=${filter}` : ""}`),
  });

  const staff = useQuery<{ staff: { id: string; name: string; role: string }[] }>({ queryKey: ["admin-staff"], queryFn: () => api("/admin/staff") });

  const update = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) => api(`/admin/requests/${vars.id}`, { method: "PATCH", body: vars.body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      show("Request updated", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Update failed", "error"),
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Service Requests</Text>
      <View style={{ marginVertical: 8 }}>
        <ChipRow items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} value={filter} onChange={setFilter} testPrefix="req-filter" />
      </View>

      {isError ? (
        <ErrorState message="Could not load requests" onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonList count={3} />
      ) : !data?.requests.length ? (
        <EmptyState icon="layers" title="No requests" testID="admin-requests-empty" />
      ) : (
        <View style={{ gap: 12, paddingBottom: 40 }}>
          {data.requests.map((r, i) => (
            <Animated.View key={r.id} entering={FadeInDown.delay(Math.min(i, 8) * 35).springify().damping(15)}>
              <Pressable onPress={() => { setManage(r); setAck(""); setFilingDate(""); }} testID={`admin-request-${r.id}`}>
                <Card style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{r.service_name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{r.client?.name} · {r.client?.client_code} · {r.fy}</Text>
                    </View>
                    <StatusBadge status={r.status} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>₹{r.price.toLocaleString("en-IN")} · payment {r.payment_status}</Text>
                    <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 12 }}>Manage →</Text>
                  </View>
                </Card>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={!!manage} onClose={() => setManage(null)} title={manage ? `${manage.service_name} — ${manage.client?.name ?? ""}` : ""}>
        <ScrollView style={{ maxHeight: 540 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 10, paddingBottom: 30 }}>
            <Text style={{ color: colors.muted, fontSize: 12.5 }}>Move the service through its workflow:</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {STATUSES.map((st) => (
                <Pressable key={st} onPress={() => update.mutate({ id: manage!.id, body: { status: st } })} style={s.statusBtn} testID={`set-status-${st}`}>
                  <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12, textTransform: "capitalize" }}>{st.replace(/_/g, " ")}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.section}>Assign staff</Text>
            {(staff.data?.staff ?? []).map((s) => (
              <Pressable key={s.id} onPress={() => update.mutate({ id: manage!.id, body: { assigned_staff_id: s.id } })} style={s.statusBtn} testID={`assign-${s.id}`}>
                <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12 }}>{s.name} · {s.role.replace(/_/g, " ")}</Text>
              </Pressable>
            ))}
            <Text style={s.section}>Filing details</Text>
            <Input label="Acknowledgement number" value={ack} onChangeText={setAck} testID="ack-input" />
            <Input label="Filing date (YYYY-MM-DD)" value={filingDate} onChangeText={setFilingDate} testID="filing-date-input" />
            <Button label="Save details" onPress={() => update.mutate({ id: manage!.id, body: { ...(ack ? { acknowledgement_no: ack } : {}), ...(filingDate ? { filing_date: filingDate } : {}) } })} testID="save-filing" />
            <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />
            <DeleteButton
              testID={`delete-request-${manage?.id ?? "x"}`}
              title="Delete this service request?"
              message="The request, its invoice, payment and documents will be removed from all lists and totals. Data is retained and can be restored by support."
              onConfirm={async () => {
                await api(`/admin/requests/${manage!.id}`, { method: "DELETE" });
                qc.invalidateQueries({ queryKey: ["admin-requests"] });
                qc.invalidateQueries({ queryKey: ["admin-stats"] });
                setManage(null);
                show("Service request deleted", "success");
              }}
            />
          </View>
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  section: { color: colors.onSurface, fontSize: 14.5, fontWeight: "800", marginTop: 6 },
  statusBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceTertiary, flexShrink: 0 },
}));
