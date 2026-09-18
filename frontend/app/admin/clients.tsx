// Clients: search + detail (businesses, requests, invoices, internal notes).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, EmptyState, ErrorState, Icon, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

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
