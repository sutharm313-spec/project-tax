// Bulk pricing: set one service's price for many clients at once (Client+Service+FY+AY).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { Button, Card, ChipRow, Icon, Input, SkeletonList, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Client = { id: string; name: string; client_code: string; email: string };
type Svc = { id: string; name: string; category: string; suggested_price: number };

const FY_LIST = ["FY 2024-25", "FY 2025-26", "FY 2026-27", "FY 2027-28"];

export default function BulkPricing() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [svcQuery, setSvcQuery] = useState("");
  const [svcId, setSvcId] = useState<string | null>(null);
  const [fy, setFy] = useState<string>("FY 2026-27");
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const clients = useQuery<{ clients: Client[] }>({ queryKey: ["admin-clients", ""], queryFn: () => api("/admin/clients") });
  const svcData = useQuery<{ services: Svc[] }>({ queryKey: ["catalog-admin-list"], queryFn: async () => {
    const first = (await api<{ clients: Client[] }>("/admin/clients")).clients[0];
    return first ? api(`/admin/clients/${first.id}/prices`) : { services: [] };
  } });

  const svcs = useMemo(() => (svcData.data?.services ?? []).filter((v) => v.name.toLowerCase().includes(svcQuery.toLowerCase())), [svcData.data, svcQuery]);
  const selectedSvc = svcData.data?.services.find((v) => v.id === svcId);
  const chosen = Object.keys(selected).filter((k) => selected[k]);

  const save = useMutation({
    mutationFn: () => api("/admin/prices/bulk", { method: "POST", body: { client_ids: chosen, service_id: svcId, fy, amount: parseInt(amount, 10) } }),
    onSuccess: (r: { updated: number }) => {
      qc.invalidateQueries({ queryKey: ["client-prices"] });
      show(`Price applied to ${r.updated} client(s)`, "success");
      setSelected({}); setAmount("");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not apply", "error"),
  });

  const canSave = svcId && fy && amount.trim() && chosen.length > 0;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Bulk Pricing</Text>
      <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>Set one service&apos;s price across many clients for a financial year.</Text>

      <Card style={{ gap: 12, marginTop: 14 }}>
        <Input value={svcQuery} onChangeText={setSvcQuery} placeholder="Search service…" testID="bulk-svc-search" />
        {svcQuery.length > 0 && !selectedSvc ? (
          <View style={{ maxHeight: 180 }}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 180 }}>
              {svcs.slice(0, 14).map((v) => (
                <Pressable key={v.id} onPress={() => { setSvcId(v.id); setSvcQuery(v.name); }} style={s.svcRow} testID={`bulk-svc-${v.name}`}>
                  <Text style={{ color: colors.onSurface, flex: 1, fontWeight: "600", fontSize: 13 }}>{v.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11, textTransform: "capitalize" }}>{v.category.replace(/_/g, " ")}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {selectedSvc ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="pricetag" size={15} color={colors.brand} />
            <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{selectedSvc.name}</Text>
            <Pressable onPress={() => { setSvcId(null); setSvcQuery(""); }} testID="bulk-svc-clear"><Icon name="close-circle" size={18} color={colors.muted} /></Pressable>
          </View>
        ) : null}
        <ChipRow items={FY_LIST.map((f) => ({ key: f, label: f }))} value={fy} onChange={setFy} testPrefix="bulk-fy" />
        <Input value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" placeholder="Amount (₹)" testID="bulk-amount" />
      </Card>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 8 }}>
        <Text style={s.section}>Select clients ({chosen.length})</Text>
        <Pressable onPress={() => setSelected(clients.data?.clients.reduce((a, c) => ({ ...a, [c.id]: true }), {}) ?? {})} testID="bulk-select-all">
          <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 12.5 }}>Select all</Text>
        </Pressable>
      </View>

      {clients.isLoading ? (
        <SkeletonList count={4} />
      ) : (
        <View style={{ gap: 8 }}>
          {clients.data?.clients.map((c) => {
            const on = !!selected[c.id];
            return (
              <Pressable key={c.id} onPress={() => setSelected((p) => ({ ...p, [c.id]: !p[c.id] }))} testID={`bulk-client-${c.client_code}`}>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Icon name={on ? "checkbox" : "square-outline"} size={20} color={on ? colors.brand : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{c.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{c.client_code} · {c.email}</Text>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={{ marginTop: 16 }}>
        <Button label={`Apply price to ${chosen.length} client(s)`} icon="cash" disabled={!canSave} loading={save.isPending} onPress={() => save.mutate()} testID="bulk-apply" />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  section: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  svcRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider },
}));
