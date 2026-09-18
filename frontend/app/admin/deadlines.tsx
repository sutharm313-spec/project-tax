// Deadlines & document-expiry tracking with reminder dispatch.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, Icon, Input, Sheet, SkeletonList, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Client = { id: string; name: string; client_code: string };
type Deadline = { id: string; title: string; due_date: string; kind: string; is_expiry?: boolean; reminded_at?: string | null; client?: { name: string; client_code: string } | null };

const KINDS = [
  { key: "compliance", label: "Compliance" }, { key: "gst", label: "GST" },
  { key: "income_tax", label: "Income Tax" }, { key: "tds", label: "TDS" },
  { key: "audit", label: "Audit" }, { key: "expiry", label: "Doc Expiry" },
];

export default function Deadlines() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [kind, setKind] = useState("compliance");
  const [isExpiry, setIsExpiry] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientQuery, setClientQuery] = useState("");

  const list = useQuery<{ deadlines: Deadline[] }>({ queryKey: ["admin-deadlines"], queryFn: () => api("/admin/deadlines") });
  const clients = useQuery<{ clients: Client[] }>({ queryKey: ["admin-clients", ""], queryFn: () => api("/admin/clients") });
  const selectedClient = clients.data?.clients.find((c) => c.id === clientId);

  const create = useMutation({
    mutationFn: () => api("/admin/deadlines", { method: "POST", body: { title, due_date: due, kind, client_id: clientId, is_expiry: isExpiry } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-deadlines"] }); show("Deadline added", "success"); reset(); },
    onError: (e) => show(e instanceof Error ? e.message : "Could not add", "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/deadlines/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-deadlines"] }); show("Removed", "success"); },
  });
  const remind = useMutation({
    mutationFn: () => api("/admin/deadlines/run-reminders", { method: "POST" }),
    onSuccess: (r: { reminders_sent: number }) => show(`${r.reminders_sent} reminder(s) sent`, "success"),
    onError: (e) => show(e instanceof Error ? e.message : "Failed", "error"),
  });

  const reset = () => { setOpen(false); setTitle(""); setDue(""); setKind("compliance"); setIsExpiry(false); setClientId(null); setClientQuery(""); };
  const canSave = title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(due);
  const daysTo = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);

  const filteredClients = useMemo(() => (clients.data?.clients ?? []).filter((c) => c.name.toLowerCase().includes(clientQuery.toLowerCase()) || c.client_code.toLowerCase().includes(clientQuery.toLowerCase())), [clients.data, clientQuery]);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={s.title}>Deadlines & Expiry</Text>
        <Button label="Send reminders" icon="notifications" variant="soft" onPress={() => remind.mutate()} loading={remind.isPending} testID="deadlines-remind" style={{ minWidth: 150 }} />
      </View>
      <Button label="Add deadline / expiry" icon="add-circle" onPress={() => setOpen(true)} testID="deadline-new" style={{ marginTop: 12 }} />

      <View style={{ marginTop: 16, gap: 10 }}>
        {list.isLoading ? (
          <SkeletonList count={3} />
        ) : !list.data?.deadlines.length ? (
          <EmptyState icon="alarm" title="No deadlines" body="Track filing dates and document expiries and remind clients automatically." testID="deadlines-empty" />
        ) : (
          list.data.deadlines.map((d, i) => {
            const dt = daysTo(d.due_date);
            const soon = dt <= 7;
            return (
              <Animated.View key={d.id} entering={FadeInDown.delay(i * 35).springify().damping(15)}>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }} testID={`deadline-${d.id}`}>
                  <View style={[s.dot, { backgroundColor: soon ? colors.error : dt <= 30 ? colors.warning : colors.brand }]}>
                    <Icon name={d.is_expiry ? "shield-checkmark" : "alarm"} size={16} color="#FFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{d.title}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{d.due_date} · {dt < 0 ? "overdue" : `${dt}d left`}{d.client ? ` · ${d.client.client_code}` : " · all clients"}</Text>
                  </View>
                  <Pressable onPress={() => remove.mutate(d.id)} testID={`deadline-del-${d.id}`}><Icon name="trash" size={18} color={colors.muted} /></Pressable>
                </Card>
              </Animated.View>
            );
          })
        )}
      </View>

      <Sheet visible={open} onClose={reset} title="Add deadline / expiry">
        <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 12, paddingBottom: 24 }}>
            <Input label="Title" value={title} onChangeText={setTitle} placeholder="e.g. GSTR-3B filing" testID="deadline-title" />
            <Input label="Due date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="2026-10-20" testID="deadline-due" />
            <Text style={s.lbl}>Type</Text>
            <ChipRow items={KINDS} value={kind} onChange={setKind} testPrefix="deadline-kind" />
            <Pressable onPress={() => setIsExpiry((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }} testID="deadline-expiry-toggle">
              <Icon name={isExpiry ? "checkbox" : "square-outline"} size={20} color={isExpiry ? colors.brand : colors.muted} />
              <Text style={{ color: colors.onSurface, fontSize: 13.5 }}>This is a document / license expiry</Text>
            </Pressable>
            <Text style={s.lbl}>Client (optional — leave empty for all)</Text>
            {!selectedClient ? (
              <>
                <Input value={clientQuery} onChangeText={setClientQuery} placeholder="Search client…" testID="deadline-client-search" />
                {clientQuery.length > 0 ? (
                  <View style={{ maxHeight: 150 }}>
                    <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 150 }}>
                      {filteredClients.map((c) => (
                        <Pressable key={c.id} onPress={() => setClientId(c.id)} style={s.row} testID={`deadline-client-${c.client_code}`}>
                          <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{c.name} · {c.client_code}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="person" size={15} color={colors.brand} />
                <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{selectedClient.name}</Text>
                <Pressable onPress={() => setClientId(null)}><Icon name="close-circle" size={18} color={colors.muted} /></Pressable>
              </View>
            )}
            <Button label="Add deadline" icon="checkmark-circle" disabled={!canSave} loading={create.isPending} onPress={() => create.mutate()} testID="deadline-save" />
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
  dot: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
}));
