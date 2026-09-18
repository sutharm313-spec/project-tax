// CRM lead pipeline.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, DeleteButton, EmptyState, ErrorState, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Lead = { id: string; name: string; mobile: string; email: string; source: string; interested_service: string; status: string; follow_up_date: string | null; notes: string };

const STATUSES = ["new", "contacted", "follow_up", "proposal_sent", "converted", "lost"];

export default function AdminLeads() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", mobile: "", email: "", source: "", interested_service: "", follow_up_date: "", notes: "" });

  const { data, isLoading, isError, refetch } = useQuery<{ leads: Lead[] }>({
    queryKey: ["admin-leads", filter],
    queryFn: () => api(`/admin/leads${filter ? `?status=${filter}` : ""}`),
  });

  const create = useMutation({
    mutationFn: () => api("/admin/leads", { method: "POST", body: { ...form, status: "new" } }),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: "", mobile: "", email: "", source: "", interested_service: "", follow_up_date: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["admin-leads"] });
      show("Lead added", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not add lead", "error"),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: string }) => api(`/admin/leads/${vars.id}`, { method: "PATCH", body: { status: vars.status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-leads"] });
      show("Lead updated", "success");
    },
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={s.title}>CRM Leads</Text>
        <Button label="Add Lead" icon="add" onPress={() => setOpen(true)} testID="add-lead-btn" style={{ minWidth: 120 }} />
      </View>
      <View style={{ marginVertical: 8 }}>
        <ChipRow items={[{ key: "", label: "All" }, ...STATUSES.map((s) => ({ key: s, label: s.replace(/_/g, " ") }))]} value={filter} onChange={setFilter} testPrefix="lead-filter" />
      </View>

      {isError ? (
        <ErrorState message="Could not load leads" onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonList count={3} />
      ) : !data?.leads.length ? (
        <EmptyState icon="trending-up" title="No leads yet" body="Add prospects to grow your practice." testID="admin-leads-empty" />
      ) : (
        <View style={{ gap: 12, paddingBottom: 40 }}>
          {data.leads.map((l, i) => (
            <Animated.View key={l.id} entering={FadeInDown.delay(Math.min(i, 8) * 35).springify().damping(15)}>
              <Card style={{ gap: 10 }} testID={`lead-${l.name}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{l.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{l.mobile} {l.email ? `· ${l.email}` : ""}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>via {l.source || "—"} · {l.interested_service || "no service"}</Text>
                  </View>
                  <StatusBadge status={l.status} />
                  <DeleteButton
                    testID={`delete-lead-${l.id}`}
                    title={`Delete lead ${l.name}?`}
                    onConfirm={async () => {
                      await api(`/admin/leads/${l.id}`, { method: "DELETE" });
                      qc.invalidateQueries({ queryKey: ["admin-leads"] });
                      show("Lead deleted", "success");
                    }}
                  />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {STATUSES.map((s) => (
                    <Pressable key={s} onPress={() => setStatus.mutate({ id: l.id, status: s })} style={[s.stBtn, l.status === s && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]} testID={`lead-${l.id}-${s}`}>
                      <Text style={{ color: l.status === s ? colors.onBrandPrimary : colors.onSurfaceTertiary, fontSize: 10.5, fontWeight: "700", textTransform: "capitalize" }}>{s.replace(/_/g, " ")}</Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add Lead">
        <ScrollView style={{ maxHeight: 540 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} testID="lead-name" />
            <Input label="Mobile" value={form.mobile} onChangeText={(v) => setForm((f) => ({ ...f, mobile: v }))} keyboardType="phone-pad" testID="lead-mobile" />
            <Input label="Email" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} testID="lead-email" />
            <Input label="Source" value={form.source} onChangeText={(v) => setForm((f) => ({ ...f, source: v }))} placeholder="referral / google / instagram" testID="lead-source" />
            <Input label="Interested service" value={form.interested_service} onChangeText={(v) => setForm((f) => ({ ...f, interested_service: v }))} testID="lead-service" />
            <Input label="Notes" value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} multiline testID="lead-notes" />
            <Button label="Save Lead" onPress={() => create.mutate()} loading={create.isPending} testID="lead-save" />
          </View>
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  stBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
}));
