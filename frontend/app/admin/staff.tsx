// Staff management: roles + granular permissions.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, EmptyState, ErrorState, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Staff = { id: string; name: string; email: string; role: string; status: string; permissions: string[] };

const ROLES = ["admin", "manager", "accountant", "tax_staff", "gst_staff", "support_staff"];
const PERMS = ["view_clients", "edit_clients", "view_documents", "approve_documents", "download_documents", "manage_payments", "manage_services", "manage_gst", "manage_itr", "manage_accounting", "manage_staff", "manage_tickets", "view_reports"];

export default function AdminStaff() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", mobile: "", password: "", role: "accountant", permissions: [] as string[] });

  const { data, isLoading, isError, refetch } = useQuery<{ staff: Staff[] }>({
    queryKey: ["admin-staff"],
    queryFn: () => api("/admin/staff"),
  });

  const create = useMutation({
    mutationFn: () => api("/admin/staff", { method: "POST", body: form }),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: "", email: "", mobile: "", password: "", role: "accountant", permissions: [] });
      qc.invalidateQueries({ queryKey: ["admin-staff"] });
      show("Staff account created", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not create staff", "error"),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: string }) => api(`/admin/staff/${vars.id}`, { method: "PATCH", body: { status: vars.status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-staff"] });
      show("Staff updated", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Update failed", "error"),
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={s.title}>Staff & Roles</Text>
        <Button label="Add Staff" icon="person-add" onPress={() => setOpen(true)} testID="add-staff-btn" style={{ minWidth: 120 }} />
      </View>

      {isError ? (
        <ErrorState message="Could not load staff" onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonList count={3} />
      ) : (
        <View style={{ gap: 10, marginTop: 12, paddingBottom: 40 }}>
          {(data?.staff ?? []).map((st, i) => (
            <Animated.View key={st.id} entering={FadeInDown.delay(Math.min(i, 8) * 35).springify().damping(15)}>
              <Card style={{ gap: 8 }} testID={`staff-${st.email}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{st.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{st.email} · {st.role.replace(/_/g, " ")}</Text>
                  </View>
                  <StatusBadge status={st.status === "active" ? "active" : "closed"} label={st.status} />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {(st.permissions.includes("*") ? ["all permissions"] : st.permissions.slice(0, 6)).map((p) => (
                    <View key={p} style={s.permChip}><Text style={{ color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "700" }}>{p.replace(/_/g, " ")}</Text></View>
                  ))}
                </View>
                {st.role !== "super_admin" ? (
                  <Button label={st.status === "active" ? "Disable" : "Enable"} variant="ghost" onPress={() => setStatus.mutate({ id: st.id, status: st.status === "active" ? "disabled" : "active" })} testID={`staff-toggle-${st.id}`} />
                ) : null}
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add Staff">
        <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} testID="staff-name" />
            <Input label="Email" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} testID="staff-email" />
            <Input label="Mobile" value={form.mobile} onChangeText={(v) => setForm((f) => ({ ...f, mobile: v }))} keyboardType="phone-pad" testID="staff-mobile" />
            <Input label="Password" value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} secure testID="staff-password" />
            <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12.5 }}>Role</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {ROLES.map((r) => (
                <Pressable key={r} onPress={() => setForm((f) => ({ ...f, role: r }))} style={[s.roleChip, form.role === r && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]} testID={`role-${r}`}>
                  <Text style={{ color: form.role === r ? "#FFF" : colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700" }}>{r.replace(/_/g, " ")}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12.5 }}>Permissions</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {PERMS.map((p) => {
                const on = form.permissions.includes(p);
                return (
                  <Pressable
                    key={p}
                    onPress={() => setForm((f) => ({ ...f, permissions: on ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] }))}
                    style={[s.roleChip, on && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
                    testID={`perm-${p}`}
                  >
                    <Text style={{ color: on ? "#FFF" : colors.onSurfaceTertiary, fontSize: 10.5, fontWeight: "700" }}>{p.replace(/_/g, " ")}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Button label="Create Staff" onPress={() => create.mutate()} loading={create.isPending} testID="staff-create" />
          </View>
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  permChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  roleChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, flexShrink: 0 },
}));
