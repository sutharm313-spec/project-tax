// Service catalog manager: pricing, active toggle, add service with document checklist.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, DeleteButton, EmptyState, ErrorState, Icon, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Svc = { id: string; name: string; category: string; price: number; active: boolean; estimated_days: number; description: string; required_docs: { key: string; name: string; required: boolean }[] };

const CATS = ["income_tax", "gst", "accounting", "tds_tcs", "audit", "business_registration", "custom"];

export default function AdminCatalog() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "income_tax", description: "", price: "999", estimated_days: "3", docs: "" });

  const { data, isLoading, isError, refetch } = useQuery<{ services: Svc[] }>({
    queryKey: ["admin-catalog"],
    queryFn: () => api("/admin/catalog"),
  });

  const create = useMutation({
    mutationFn: () => api("/admin/catalog", {
      method: "POST",
      body: {
        name: form.name, category: form.category, description: form.description, price: Number(form.price) || 0,
        price_type: "one_time", frequency: null, estimated_days: Number(form.estimated_days) || 3, active: true,
        required_docs: form.docs.split(",").map((s) => s.trim()).filter(Boolean).map((d) => ({ key: d.toLowerCase().replace(/\s+/g, "_"), name: d, required: true, instructions: "" })),
      },
    }),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: "", category: "income_tax", description: "", price: "999", estimated_days: "3", docs: "" });
      qc.invalidateQueries({ queryKey: ["admin-catalog"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      show("Service created", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not create service", "error"),
  });

  const toggle = useMutation({
    mutationFn: (s: Svc) => api(`/admin/catalog/${s.id}`, { method: "PATCH", body: { name: s.name, category: s.category, description: s.description, price: s.price, estimated_days: s.estimated_days, required_docs: s.required_docs, active: !s.active } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-catalog"] });
      show("Catalog updated", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Update failed", "error"),
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={s.title}>Service Catalog</Text>
        <Button label="Add Service" icon="add" onPress={() => setOpen(true)} testID="add-service-btn" style={{ minWidth: 130 }} />
      </View>

      {isError ? (
        <ErrorState message="Could not load catalog" onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonList count={4} />
      ) : !data?.services.length ? (
        <EmptyState icon="pricetags" title="No services" testID="admin-catalog-empty" />
      ) : (
        <View style={{ gap: 10, paddingBottom: 40, marginTop: 12 }}>
          {data.services.map((s, i) => (
            <Animated.View key={s.id} entering={FadeInDown.delay(Math.min(i, 10) * 25).springify().damping(15)}>
              <Card style={{ gap: 8 }} testID={`catalog-${s.name}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{s.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11.5, textTransform: "capitalize" }}>{s.category.replace(/_/g, " ")} · {s.required_docs.length} docs · {s.estimated_days}d</Text>
                  </View>
                  <Text style={{ color: colors.brand, fontWeight: "800" }}>₹{s.price.toLocaleString("en-IN")}</Text>
                  <StatusBadge status={s.active ? "active" : "closed"} label={s.active ? "Active" : "Hidden"} />
                  <DeleteButton
                    testID={`delete-service-${s.id}`}
                    title={`Delete ${s.name}?`}
                    onConfirm={async () => {
                      await api(`/admin/catalog/${s.id}`, { method: "DELETE" });
                      qc.invalidateQueries({ queryKey: ["admin-catalog"] });
                      qc.invalidateQueries({ queryKey: ["catalog"] });
                      qc.invalidateQueries({ queryKey: ["admin-stats"] });
                      show("Service deleted", "success");
                    }}
                  />
                </View>
                <Pressable onPress={() => toggle.mutate(s)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} testID={`toggle-${s.id}`}>
                  <Icon name={s.active ? "eye" : "eye-off"} size={14} color={colors.muted} />
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{s.active ? "Tap to hide from clients" : "Tap to show to clients"}</Text>
                </Pressable>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add Custom Service">
        <ScrollView style={{ maxHeight: 540 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} testID="svc-name" />
            <Input label="Category" value={form.category} onChangeText={(v) => setForm((f) => ({ ...f, category: v }))} placeholder={CATS.join(" / ")} testID="svc-category" />
            <Input label="Description" value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} multiline testID="svc-desc" />
            <Input label="Price (₹)" value={form.price} onChangeText={(v) => setForm((f) => ({ ...f, price: v.replace(/\D/g, "") }))} keyboardType="number-pad" testID="svc-price" />
            <Input label="Estimated days" value={form.estimated_days} onChangeText={(v) => setForm((f) => ({ ...f, estimated_days: v.replace(/\D/g, "") }))} keyboardType="number-pad" testID="svc-days" />
            <Input label="Required documents (comma separated)" value={form.docs} onChangeText={(v) => setForm((f) => ({ ...f, docs: v }))} multiline placeholder="PAN Card, Aadhaar Card, Bank Statement" testID="svc-docs" />
            <Button label="Create Service" onPress={() => create.mutate()} loading={create.isPending} testID="svc-create" />
          </View>
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
}));
