// Clients: search + detail (businesses, requests, invoices, internal notes).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, ErrorState, Icon, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Client = { id: string; name: string; email: string; mobile: string; client_code: string; pan?: string; business_count?: number; request_count?: number };
type Detail = {
  client: Client;
  businesses: { id: string; name: string; gstin?: string; type: string }[];
  requests: { id: string; service_name: string; fy: string; status: string; payment_status: string }[];
  invoices: { id: string; number: string; total: number; status: string }[];
  notes: { id: string; body: string; author_name: string; created_at: string }[];
};

export default function AdminClients() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const list = useQuery<{ clients: Client[] }>({
    queryKey: ["admin-clients", q],
    queryFn: () => api(`/admin/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  const detail = useQuery<Detail>({
    queryKey: ["admin-client", openId],
    queryFn: () => api(`/admin/clients/${openId}`),
    enabled: !!openId,
  });

  const addNote = useMutation({
    mutationFn: () => api(`/admin/clients/${openId}/notes`, { method: "POST", body: { body: note, context: "client" } }),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin-client", openId] });
      show("Internal note saved (never visible to client)", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not save note", "error"),
  });

  const d = detail.data;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Clients</Text>
      <View style={{ marginVertical: 10 }}>
        <Input value={q} onChangeText={setQ} placeholder="Search name, ID, email, mobile, PAN…" testID="admin-client-search" />
      </View>

      {list.isError ? (
        <ErrorState message="Could not load clients" onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <SkeletonList count={3} />
      ) : !list.data?.clients.length ? (
        <EmptyState icon="people" title="No clients found" testID="admin-clients-empty" />
      ) : (
        <View style={{ gap: 10, paddingBottom: 40 }}>
          {list.data.clients.map((c, i) => (
            <Animated.View key={c.id} entering={FadeInDown.delay(Math.min(i, 8) * 35).springify().damping(15)}>
              <Pressable onPress={() => setOpenId(c.id)} testID={`admin-client-${c.client_code}`}>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={s.avatar}><Text style={{ color: "#FFF", fontWeight: "800" }}>{c.name.slice(0, 1)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{c.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{c.client_code} · {c.email}</Text>
                  </View>
                  <Icon name="chevron-forward" size={16} color={colors.muted} />
                </Card>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={!!openId} onClose={() => setOpenId(null)} title={d?.client.name ?? "Client"}>
        <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
          {d ? (
            <View style={{ gap: 14, paddingBottom: 30 }}>
              <Card style={{ gap: 6 }}>
                <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{d.client.client_code}</Text>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>{d.client.email} · {d.client.mobile}</Text>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>PAN: {d.client.pan || "—"}</Text>
              </Card>

              <Text style={s.section}>Businesses ({d.businesses.length})</Text>
              {d.businesses.map((b) => (
                <Card key={b.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Icon name="business" size={16} color={colors.brand} />
                  <Text style={{ color: colors.onSurface, flex: 1, fontWeight: "700" }}>{b.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{b.gstin || b.type}</Text>
                </Card>
              ))}

              <Text style={s.section}>Service Requests</Text>
              {d.requests.map((r) => (
                <Card key={r.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Text style={{ color: colors.onSurface, flex: 1, fontWeight: "700" }}>{r.service_name} · {r.fy}</Text>
                  <StatusBadge status={r.status} />
                </Card>
              ))}
              {!d.requests.length ? <Text style={{ color: colors.muted }}>No requests</Text> : null}

              {openId ? <PricingPanel clientId={openId} /> : null}

              <Text style={s.section}>Invoices</Text>
              {d.invoices.map((inv) => (
                <Card key={inv.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Text style={{ color: colors.onSurface, flex: 1, fontWeight: "700" }}>{inv.number}</Text>
                  <Text style={{ color: colors.onSurface, fontWeight: "700" }}>₹{inv.total.toLocaleString("en-IN")}</Text>
                  <StatusBadge status={inv.status} />
                </Card>
              ))}

              <Text style={s.section}>Internal Notes (private)</Text>
              {d.notes.map((n) => (
                <Card key={n.id} style={{ gap: 4 }}>
                  <Text style={{ color: colors.onSurface, fontSize: 13 }}>{n.body}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10.5 }}>{n.author_name} · {new Date(n.created_at).toLocaleString("en-IN")}</Text>
                </Card>
              ))}
              <Input value={note} onChangeText={setNote} placeholder="Add an internal note…" testID="internal-note-input" multiline />
              <Button label="Save Note" icon="lock-closed" onPress={() => note.trim() && addNote.mutate()} loading={addNote.isPending} testID="internal-note-save" />
            </View>
          ) : (
            <Text style={{ color: colors.muted }}>Loading…</Text>
          )}
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  avatar: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  section: { color: colors.onSurface, fontSize: 15, fontWeight: "800", marginTop: 4 },
}));

// ---- Service & Pricing (client-specific private pricing) ----
type Svc = { id: string; name: string; category: string; suggested_price: number };
type Price = { id: string; service_id: string; service_name: string; fy: string; ay: string; amount: number; active: boolean; history?: { action: string; amount: number; at: string; by_name?: string }[] };
type PricesResp = { prices: Price[]; services: Svc[]; fy_list: string[] };

function PricingPanel({ clientId }: { clientId: string }) {
  const { colors } = useTheme();
  const ps = usePricingStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [svcQuery, setSvcQuery] = useState("");
  const [svcId, setSvcId] = useState<string | null>(null);
  const [fy, setFy] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [historyOf, setHistoryOf] = useState<Price | null>(null);

  const data = useQuery<PricesResp>({ queryKey: ["client-prices", clientId], queryFn: () => api(`/admin/clients/${clientId}/prices`) });

  const save = useMutation({
    mutationFn: () => api(`/admin/clients/${clientId}/prices`, { method: "POST", body: { service_id: svcId, fy, amount: parseInt(amount, 10) } }),
    onSuccess: () => {
      setSvcId(null); setFy(null); setAmount(""); setSvcQuery("");
      qc.invalidateQueries({ queryKey: ["client-prices", clientId] });
      show("Price assigned to this client", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not save price", "error"),
  });

  const toggle = useMutation({
    mutationFn: (p: Price) => api(`/admin/prices/${p.id}`, { method: "PUT", body: { active: !p.active } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["client-prices", clientId] }); show("Pricing updated", "success"); },
    onError: (e) => show(e instanceof Error ? e.message : "Could not update", "error"),
  });

  const svcs = (data.data?.services ?? []).filter((sv) => sv.name.toLowerCase().includes(svcQuery.toLowerCase()));
  const fyList = data.data?.fy_list ?? [];
  const selectedSvc = data.data?.services.find((sv) => sv.id === svcId);
  const canSave = svcId && fy && amount.trim() && parseInt(amount, 10) >= 0;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.onSurface, fontSize: 15, fontWeight: "800", marginTop: 4 }}>Service &amp; Pricing (private)</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Set custom prices per service, financial year &amp; assessment year. Only this client sees these prices.</Text>

      <Card style={{ gap: 10 }}>
        <Input value={svcQuery} onChangeText={setSvcQuery} placeholder="Search service to price…" testID="price-svc-search" />
        {svcQuery.length > 0 && !selectedSvc ? (
          <View style={{ gap: 6, maxHeight: 160 }}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 160 }}>
              {svcs.slice(0, 12).map((sv) => (
                <Pressable key={sv.id} onPress={() => { setSvcId(sv.id); setSvcQuery(sv.name); }} style={ps.svcRow} testID={`price-svc-${sv.name}`}>
                  <Text style={{ color: colors.onSurface, flex: 1, fontWeight: "600", fontSize: 13 }}>{sv.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11, textTransform: "capitalize" }}>{sv.category.replace(/_/g, " ")}</Text>
                </Pressable>
              ))}
              {!svcs.length ? <Text style={{ color: colors.muted, fontSize: 12 }}>No match</Text> : null}
            </ScrollView>
          </View>
        ) : null}
        {selectedSvc ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="pricetag" size={15} color={colors.brand} />
              <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{selectedSvc.name}</Text>
              <Pressable onPress={() => { setSvcId(null); setSvcQuery(""); }} testID="price-svc-clear"><Icon name="close-circle" size={18} color={colors.muted} /></Pressable>
            </View>
            <ChipRow items={fyList.map((f) => ({ key: f, label: f }))} value={fy ?? ""} onChange={setFy} testPrefix="price-fy" />
            <Input value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" placeholder={`Amount (₹) — suggested ₹${selectedSvc.suggested_price}`} testID="price-amount-input" />
            <Button label="Assign Price" icon="checkmark-circle" disabled={!canSave} loading={save.isPending} onPress={() => save.mutate()} testID="price-save-btn" />
          </>
        ) : null}
      </Card>

      {data.data?.prices.length ? (
        data.data.prices.map((p) => (
          <Card key={p.id} style={{ gap: 4 }} testID={`price-row-${p.id}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 13.5 }}>{p.service_name}</Text>
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>{p.fy} · {p.ay}</Text>
              </View>
              <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 15 }}>₹{p.amount.toLocaleString("en-IN")}</Text>
              <StatusBadge status={p.active ? "approved" : "cancelled"} label={p.active ? "Active" : "Inactive"} />
            </View>
            <View style={{ flexDirection: "row", gap: 14, marginTop: 2 }}>
              <Pressable onPress={() => toggle.mutate(p)} testID={`price-toggle-${p.id}`}><Text style={{ color: p.active ? colors.error : colors.success, fontSize: 12, fontWeight: "700" }}>{p.active ? "Deactivate" : "Activate"}</Text></Pressable>
              <Pressable onPress={() => setHistoryOf(p)} testID={`price-history-${p.id}`}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "700" }}>History ({p.history?.length ?? 0})</Text></Pressable>
            </View>
          </Card>
        ))
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12 }}>No prices assigned yet. Client cannot pay until a price is set.</Text>
      )}

      <Sheet visible={!!historyOf} onClose={() => setHistoryOf(null)} title="Pricing history">
        <View style={{ gap: 8, paddingBottom: 20 }}>
          {(historyOf?.history ?? []).slice().reverse().map((h, i) => (
            <Card key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View>
                <Text style={{ color: colors.onSurface, fontWeight: "700", textTransform: "capitalize" }}>{h.action.replace(/_/g, " ")}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>{h.by_name ?? "—"} · {new Date(h.at).toLocaleString("en-IN")}</Text>
              </View>
              <Text style={{ color: colors.onSurface, fontWeight: "800" }}>₹{h.amount.toLocaleString("en-IN")}</Text>
            </Card>
          ))}
          {!(historyOf?.history ?? []).length ? <Text style={{ color: colors.muted }}>No history</Text> : null}
        </View>
      </Sheet>
    </View>
  );
}

const usePricingStyles = makeStyles((colors) => ({
  svcRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider },
}));
