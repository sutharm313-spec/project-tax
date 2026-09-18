// Admin analytics dashboard: stat cards, revenue bars, service distribution, workload.
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { Card, ErrorState, Icon, SectionHeader, Skeleton } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Stats = {
  cards: Record<string, number>;
  charts: { revenue_by_month: [string, number][]; client_growth: [string, number][]; service_distribution: [string, number][]; payment_status: [string, number][]; document_status: [string, number][] };
  staff_workload: { id: string; name: string; role: string; active_requests: number }[];
};

const INR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function Bars({ data, format }: { data: [string, number][]; format?: (n: number) => string }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...data.map(([, v]) => v));
  if (!data.length) return <Text style={{ color: colors.muted }}>No data yet</Text>;
  return (
    <View style={{ gap: 8 }}>
      {data.slice(-6).map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: colors.muted, fontSize: 11, width: 64 }}>{k}</Text>
          <View style={{ flex: 1, height: 10, backgroundColor: colors.surfaceTertiary, borderRadius: 5, overflow: "hidden" }}>
            <View style={{ width: `${(v / max) * 100}%`, height: 10, backgroundColor: colors.brandPrimary, borderRadius: 5 }} />
          </View>
          <Text style={{ color: colors.onSurface, fontSize: 11.5, fontWeight: "700", width: 70, textAlign: "right" }}>{format ? format(v) : v}</Text>
        </View>
      ))}
    </View>
  );
}

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const { data, isLoading, isError, refetch } = useQuery<Stats>({ queryKey: ["admin-stats"], queryFn: () => api("/admin/stats") });

  if (isError) return <View style={{ flex: 1, justifyContent: "center" }}><ErrorState message="Could not load stats" onRetry={() => refetch()} /></View>;

  const cards = data?.cards ?? {};
  const cardDefs = [
    { key: "total_clients", label: "Total Clients", icon: "people", color: "#3B82F6" },
    { key: "active_services", label: "Active Services", icon: "sync", color: "#8B5CF6" },
    { key: "pending_payments", label: "Pending Payments", icon: "card", color: "#F59E0B", money: true },
    { key: "revenue", label: "Revenue", icon: "trending-up", color: "#10B981", money: true },
    { key: "pending_documents", label: "Pending Documents", icon: "document-text", color: "#06B6D4" },
    { key: "completed_services", label: "Completed", icon: "checkmark-circle", color: "#10B981" },
    { key: "open_tickets", label: "Open Tickets", icon: "headset", color: "#EF4444" },
    { key: "new_clients", label: "New (30d)", icon: "person-add", color: "#3B82F6" },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: 14, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={s.title}>Dashboard</Text>
        <View style={[s.liveBadge, { borderColor: colors.success }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success }} />
          <Text style={{ color: colors.success, fontSize: 11, fontWeight: "800" }}>LIVE</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} width="47%" height={84} style={{ borderRadius: radius.lg }} />)}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {cardDefs.map((c, i) => (
            <Animated.View key={c.key} entering={FadeInDown.delay(i * 35).springify().damping(15)} style={{ flexGrow: 1, flexBasis: "47%", maxWidth: "100%" }}>
              <Card testID={`admin-stat-${c.key}`} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: "700" }}>{c.label}</Text>
                  <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: `${c.color}22`, alignItems: "center", justifyContent: "center" }}>
                    <Icon name={c.icon} size={14} color={c.color} />
                  </View>
                </View>
                <Text style={{ color: colors.onSurface, fontSize: 22, fontWeight: "800" }}>{c.money ? INR(cards[c.key] ?? 0) : (cards[c.key] ?? 0).toLocaleString("en-IN")}</Text>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <SectionHeader title="Revenue Trend" />
      <Card><Bars data={data?.charts.revenue_by_month ?? []} format={INR} /></Card>

      <SectionHeader title="Service Distribution" />
      <Card><Bars data={data?.charts.service_distribution ?? []} /></Card>

      <SectionHeader title="Payment Status" />
      <Card><Bars data={data?.charts.payment_status ?? []} /></Card>

      <SectionHeader title="Client Growth" />
      <Card><Bars data={data?.charts.client_growth ?? []} /></Card>

      <SectionHeader title="Staff Workload" />
      <Card style={{ gap: 10 }}>
        {(data?.staff_workload ?? []).map((w) => (
          <View key={w.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon name="person" size={15} color={colors.muted} />
            <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{w.name} <Text style={{ color: colors.muted, fontWeight: "500", fontSize: 11 }}>· {w.role.replace(/_/g, " ")}</Text></Text>
            <Text style={{ color: colors.brand, fontWeight: "800" }}>{w.active_requests} active</Text>
          </View>
        ))}
        {!data?.staff_workload.length ? <Text style={{ color: colors.muted }}>No staff yet</Text> : null}
      </Card>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
}));
