// Deadlines & document-expiry tracking with reminder dispatch.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, Icon, Input, Sheet, SkeletonList, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Client = { id: string; name: string; client_code: string };
type Deadline = { id: string; title: string; due_date: string; kind: string; is_expiry?: boolean; reminded_at?: string | null; client?: { name: string; client_code: string } | null };

const KINDS = [
  { key: "compliance", label: "Compliance" }, { key: "gst", label: "GST" },
  { key: "income_tax", label: "Income Tax" }, { key: "tds", label: "TDS" },
  { key: "audit", label: "Audit" }, { key: "expiry", label: "Doc Expiry" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

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
  const [view, setView] = useState<"list" | "calendar">("list");
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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

      <View style={{ marginTop: 12 }}>
        <ChipRow items={[{ key: "list", label: "List" }, { key: "calendar", label: "Calendar" }]} value={view} onChange={(k) => setView(k as "list" | "calendar")} testPrefix="deadline-view" />
      </View>

      {view === "calendar" ? (
        <MonthCalendar
          deadlines={list.data?.deadlines ?? []}
          cursor={monthCursor}
          onPrev={() => setMonthCursor((c) => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })}
          onNext={() => setMonthCursor((c) => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })}
          onPickDay={setSelectedDay}
        />
      ) : (
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
      )}

      <Sheet visible={!!selectedDay} onClose={() => setSelectedDay(null)} title={selectedDay ? new Date(selectedDay).toDateString() : "Day"}>
        <View style={{ gap: 8, paddingBottom: 20 }}>
          {(list.data?.deadlines ?? []).filter((d) => d.due_date === selectedDay).map((d) => (
            <Card key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Icon name={d.is_expiry ? "shield-checkmark" : "alarm"} size={16} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{d.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{d.client ? d.client.client_code : "all clients"} · {d.kind}</Text>
              </View>
              <Pressable onPress={() => remove.mutate(d.id)} testID={`cal-del-${d.id}`}><Icon name="trash" size={17} color={colors.muted} /></Pressable>
            </Card>
          ))}
          {!(list.data?.deadlines ?? []).filter((d) => d.due_date === selectedDay).length ? <Text style={{ color: colors.muted }}>No deadlines on this day.</Text> : null}
        </View>
      </Sheet>

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

// ---- Month calendar view ----
function MonthCalendar({ deadlines, cursor, onPrev, onNext, onPickDay }: {
  deadlines: Deadline[];
  cursor: { y: number; m: number };
  onPrev: () => void; onNext: () => void; onPickDay: (iso: string) => void;
}) {
  const { colors } = useTheme();
  const c = useCalStyles();
  const first = new Date(cursor.y, cursor.m, 1);
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const lead = first.getDay();
  const todayIso = new Date().toISOString().slice(0, 10);

  const byDay: Record<string, Deadline[]> = {};
  for (const d of deadlines) {
    const [y, m] = d.due_date.split("-").map((x) => parseInt(x, 10));
    if (y === cursor.y && m === cursor.m + 1) (byDay[d.due_date] ??= []).push(d);
  }

  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const iso = (day: number) => `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const urgencyColor = (list: Deadline[]) => {
    const min = Math.min(...list.map((d) => Math.ceil((new Date(d.due_date).getTime() - Date.now()) / 86400000)));
    return min <= 7 ? colors.error : min <= 30 ? colors.warning : colors.brand;
  };

  return (
    <View style={{ marginTop: 14 }}>
      <View style={c.head}>
        <Pressable onPress={onPrev} style={c.navBtn} testID="cal-prev"><Icon name="chevron-back" size={18} color={colors.onSurface} /></Pressable>
        <Text style={c.monthLabel}>{MONTHS[cursor.m]} {cursor.y}</Text>
        <Pressable onPress={onNext} style={c.navBtn} testID="cal-next"><Icon name="chevron-forward" size={18} color={colors.onSurface} /></Pressable>
      </View>
      <View style={c.dowRow}>
        {DOW.map((d, i) => <Text key={i} style={c.dow}>{d}</Text>)}
      </View>
      <View style={c.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={c.cell} />;
          const dIso = iso(day);
          const items = byDay[dIso] ?? [];
          const isToday = dIso === todayIso;
          return (
            <Pressable key={i} style={[c.cell, c.dayCell, isToday && { borderColor: colors.brand, borderWidth: 1.5 }]} onPress={() => onPickDay(dIso)} testID={`cal-day-${day}`}>
              <Text style={[c.dayNum, isToday && { color: colors.brand, fontWeight: "800" }]}>{day}</Text>
              {items.length ? (
                <View style={[c.badge, { backgroundColor: urgencyColor(items) }]}>
                  <Text style={c.badgeText}>{items.length}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={c.legend}>
        {[["≤7d", colors.error], ["≤30d", colors.warning], ["later", colors.brand]].map(([l, col]) => (
          <View key={l as string} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: col as string }} />
            <Text style={{ color: colors.muted, fontSize: 11 }}>{l as string}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useCalStyles = makeStyles((colors) => ({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  monthLabel: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  dowRow: { flexDirection: "row" },
  dow: { flex: 1, textAlign: "center", color: colors.muted, fontSize: 11, fontWeight: "700", paddingVertical: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  dayCell: { borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", margin: 1 },
  dayNum: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", marginTop: 2 },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  legend: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 12 },
}));
