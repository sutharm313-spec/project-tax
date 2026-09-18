// Recurring services: auto-create monthly GST / quarterly TDS etc. each period.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, Icon, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Client = { id: string; name: string; client_code: string };
type Svc = { id: string; name: string; category: string; suggested_price: number };
type Biz = { id: string; name: string };
type Plan = { id: string; service_name: string; fy: string; ay: string; frequency: string; amount: number; next_due: string; active: boolean; runs: number; client?: { name: string; client_code: string } | null };

const FY_LIST = ["FY 2024-25", "FY 2025-26", "FY 2026-27", "FY 2027-28"];
const FREQ = [{ key: "monthly", label: "Monthly" }, { key: "quarterly", label: "Quarterly" }, { key: "annual", label: "Annual" }];

export default function Recurring() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [bizId, setBizId] = useState<string | null>(null);
  const [svcQuery, setSvcQuery] = useState("");
  const [svcId, setSvcId] = useState<string | null>(null);
  const [fy, setFy] = useState("FY 2026-27");
  const [freq, setFreq] = useState("monthly");
  const [amount, setAmount] = useState("");
  const [nextDue, setNextDue] = useState("");

  const list = useQuery<{ recurring: Plan[] }>({ queryKey: ["admin-recurring"], queryFn: () => api("/admin/recurring") });
  const clients = useQuery<{ clients: Client[] }>({ queryKey: ["admin-clients", ""], queryFn: () => api("/admin/clients") });
  const detail = useQuery<{ businesses: Biz[]; prices?: unknown; services: Svc[] }>({
    queryKey: ["admin-client", clientId, "recurring"],
    queryFn: () => api(`/admin/clients/${clientId}/prices`).then((p: { services: Svc[] }) => api(`/admin/clients/${clientId}`).then((c: { businesses: Biz[] }) => ({ ...c, services: p.services }))),
    enabled: !!clientId,
  });

  const svcs = useMemo(() => (detail.data?.services ?? []).filter((v) => v.name.toLowerCase().includes(svcQuery.toLowerCase())), [detail.data, svcQuery]);
  const selectedClient = clients.data?.clients.find((c) => c.id === clientId);
  const selectedSvc = detail.data?.services.find((v) => v.id === svcId);

  const create = useMutation({
    mutationFn: () => api("/admin/recurring", { method: "POST", body: { client_id: clientId, business_id: bizId, service_id: svcId, fy, frequency: freq, amount: parseInt(amount, 10), next_due: nextDue } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-recurring"] }); show("Recurring plan created", "success"); reset(); },
    onError: (e) => show(e instanceof Error ? e.message : "Could not create", "error"),
  });
  const toggle = useMutation({
    mutationFn: (p: Plan) => api(`/admin/recurring/${p.id}`, { method: "PUT", body: { active: !p.active } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-recurring"] }); show("Updated", "success"); },
  });
  const runNow = useMutation({
    mutationFn: () => api("/admin/recurring/run", { method: "POST" }),
    onSuccess: (r: { created: number }) => { qc.invalidateQueries({ queryKey: ["admin-recurring"] }); show(`${r.created} request(s) created`, "success"); },
    onError: (e) => show(e instanceof Error ? e.message : "Run failed", "error"),
  });

  const reset = () => { setOpen(false); setClientId(null); setBizId(null); setSvcId(null); setClientQuery(""); setSvcQuery(""); setAmount(""); setNextDue(""); };
  const canSave = clientId && bizId && svcId && fy && freq && amount && /^\d{4}-\d{2}-\d{2}$/.test(nextDue);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={s.title}>Recurring Services</Text>
        <Button label="Run now" icon="play" variant="soft" onPress={() => runNow.mutate()} loading={runNow.isPending} testID="recurring-run" style={{ minWidth: 120 }} />
      </View>
      <Button label="New recurring plan" icon="add-circle" onPress={() => setOpen(true)} testID="recurring-new" style={{ marginTop: 12 }} />

      <View style={{ marginTop: 16, gap: 10 }}>
        {list.isLoading ? (
          <SkeletonList count={3} />
        ) : !list.data?.recurring.length ? (
          <EmptyState icon="repeat" title="No recurring plans" body="Create a plan to auto-generate monthly GST, quarterly TDS and more." testID="recurring-empty" />
        ) : (
          list.data.recurring.map((p, i) => (
            <Animated.View key={p.id} entering={FadeInDown.delay(i * 40).springify().damping(15)}>
              <Card style={{ gap: 6 }} testID={`recurring-${p.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{p.service_name} · {p.fy}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{p.client?.name} · {p.client?.client_code}</Text>
                  </View>
                  <StatusBadge status={p.active ? "approved" : "cancelled"} label={p.active ? "Active" : "Paused"} />
                </View>
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}><Text style={{ textTransform: "capitalize" }}>{p.frequency}</Text> · ₹{p.amount.toLocaleString("en-IN")}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Next: {p.next_due}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Runs: {p.runs}</Text>
                </View>
                <Pressable onPress={() => toggle.mutate(p)} testID={`recurring-toggle-${p.id}`}>
                  <Text style={{ color: p.active ? colors.error : colors.success, fontSize: 12.5, fontWeight: "700" }}>{p.active ? "Pause" : "Resume"}</Text>
                </Pressable>
              </Card>
            </Animated.View>
          ))
        )}
      </View>

      <Sheet visible={open} onClose={reset} title="New recurring plan">
        <ScrollView style={{ maxHeight: 580 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 12, paddingBottom: 24 }}>
            {!selectedClient ? (
              <>
                <Input value={clientQuery} onChangeText={setClientQuery} placeholder="Search client…" testID="rec-client-search" />
                <View style={{ maxHeight: 180 }}>
                  <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 180 }}>
                    {(clients.data?.clients ?? []).filter((c) => c.name.toLowerCase().includes(clientQuery.toLowerCase()) || c.client_code.toLowerCase().includes(clientQuery.toLowerCase())).map((c) => (
                      <Pressable key={c.id} onPress={() => setClientId(c.id)} style={s.row} testID={`rec-client-${c.client_code}`}>
                        <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{c.name} · {c.client_code}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="person" size={15} color={colors.brand} />
                <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{selectedClient.name}</Text>
                <Pressable onPress={() => { setClientId(null); setBizId(null); }}><Icon name="close-circle" size={18} color={colors.muted} /></Pressable>
              </View>
            )}

            {clientId ? (
              <>
                <Text style={s.lbl}>Business</Text>
                <ChipRow items={(detail.data?.businesses ?? []).map((b) => ({ key: b.id, label: b.name }))} value={bizId ?? ""} onChange={setBizId} testPrefix="rec-biz" />
                {!selectedSvc ? (
                  <>
                    <Input value={svcQuery} onChangeText={setSvcQuery} placeholder="Search service…" testID="rec-svc-search" />
                    <View style={{ maxHeight: 150 }}>
                      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 150 }}>
                        {svcs.slice(0, 12).map((v) => (
                          <Pressable key={v.id} onPress={() => { setSvcId(v.id); setSvcQuery(v.name); }} style={s.row} testID={`rec-svc-${v.name}`}>
                            <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{v.name}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  </>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Icon name="pricetag" size={15} color={colors.brand} />
                    <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{selectedSvc.name}</Text>
                    <Pressable onPress={() => { setSvcId(null); setSvcQuery(""); }}><Icon name="close-circle" size={18} color={colors.muted} /></Pressable>
                  </View>
                )}
                <Text style={s.lbl}>Financial year</Text>
                <ChipRow items={FY_LIST.map((f) => ({ key: f, label: f }))} value={fy} onChange={setFy} testPrefix="rec-fy" />
                <Text style={s.lbl}>Frequency</Text>
                <ChipRow items={FREQ} value={freq} onChange={setFreq} testPrefix="rec-freq" />
                <Input label="Amount (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" testID="rec-amount" />
                <Input label="First due date (YYYY-MM-DD)" value={nextDue} onChangeText={setNextDue} placeholder="2026-10-01" testID="rec-next-due" />
                <Button label="Create plan" icon="checkmark-circle" disabled={!canSave} loading={create.isPending} onPress={() => create.mutate()} testID="rec-create" />
              </>
            ) : null}
          </View>
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  lbl: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  row: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider },
}));
