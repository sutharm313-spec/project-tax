// Client dashboard: greeting, switches, metrics, Action Center, deadlines, activity.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/src/auth";
import { useClientApp } from "@/src/app-context";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api";
import { Button, Card, EmptyState, ErrorState, Icon, Metric, ProgressBar, SectionHeader, Skeleton, SkeletonList, StatusBadge } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";

type Overview = {
  user: { name: string; client_code?: string; email?: string; profile_completion: number };
  businesses: { id: string; name: string }[];
  fy_list: string[];
  counts: Record<string, number>;
  action_cards: { kind: string; severity: string; title: string; body: string; request_id?: string }[];
  deadlines: { id: string; title: string; due_date: string; kind: string }[];
  notifications: { id: string; title: string; body: string; read: boolean }[];
  recent_requests: { id: string; service_name: string; status: string; payment_status: string; fy: string }[];
};

const SEV: Record<string, string> = { warning: "#F59E0B", info: "#3B82F6", success: "#10B981", error: "#EF4444" };

function monthShort(m?: string) {
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return m ? months[parseInt(m, 10)] ?? "" : "";
}

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { businessId, setBusinessId, fy, setFy, fyList, businesses } = useClientApp();
  const [bizSheet, setBizSheet] = useState(false);
  const [fySheet, setFySheet] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<Overview>({
    queryKey: ["overview", businessId, fy],
    queryFn: () => api(`/client/overview?${businessId ? `business_id=${businessId}&` : ""}fy=${encodeURIComponent(fy)}`),
  });

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const actionIcon: Record<string, string> = {
    payment_required: "card", documents_required: "document-text", under_review: "eye", completed: "checkmark-circle",
    in_progress: "sync", waiting_info: "chatbox-ellipses", payment_review: "hourglass",
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={s.greeting}>{t("hello")},</Text>
          <Text style={s.name} numberOfLines={1}>
            {data?.user.name ?? user?.name ?? "…"} {data?.user.client_code ? `· ${data.user.client_code}` : ""}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={() => router.push("/notifications")} style={s.bell} testID="home-notifications" accessibilityRole="button">
            <Icon name="notifications" size={20} color={colors.onSurfaceTertiary} />
            {!!data?.counts.unread_notifications && (
              <View style={s.dot} testID="home-notification-badge">
                <Text style={{ color: "#FFF", fontSize: 9, fontWeight: "800" }}>{data.counts.unread_notifications}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomChrome + 24 }} showsVerticalScrollIndicator={false}>
        {/* profile completion */}
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={s.cardLabel}>{t("profile_completion")}</Text>
            <Text style={{ color: colors.brand, fontWeight: "800" }} testID="profile-completion-value">{data?.user.profile_completion ?? 0}%</Text>
          </View>
          <ProgressBar pct={data?.user.profile_completion ?? 0} />
          <Pressable onPress={() => router.push("/(tabs)/profile")} testID="home-complete-profile">
            <Text style={{ color: "#93C5FD", fontSize: 12.5, fontWeight: "600" }}>Complete your PAN & address →</Text>
          </Pressable>
        </Card>

        {/* business + FY switchers */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
          <Pressable style={s.switcher} onPress={() => setBizSheet(true)} testID="home-business-switch">
            <Icon name="business" size={16} color={colors.brand} />
            <Text style={s.switcherText} numberOfLines={1}>
              {businesses.find((b) => b.id === businessId)?.name ?? t("businesses")}
            </Text>
            <Icon name="chevron-down" size={14} color={colors.muted} />
          </Pressable>
          <Pressable style={s.switcher} onPress={() => setFySheet(true)} testID="home-fy-switch">
            <Icon name="calendar" size={16} color={colors.brand} />
            <Text style={s.switcherText}>{fy}</Text>
            <Icon name="chevron-down" size={14} color={colors.muted} />
          </Pressable>
        </View>

        {/* metrics */}
        {isLoading ? (
          <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
            {[0, 1].map((i) => (
              <Card key={i} style={{ flex: 1, gap: 10 }}>
                <Skeleton width={30} height={30} circle />
                <Skeleton width="60%" height={18} />
              </Card>
            ))}
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
            <Metric icon="sync" label={t("active_services")} value={data?.counts.active_services ?? 0} onPress={() => router.push("/(tabs)/services")} testID="metric-active-services" />
            <Metric icon="card" label={t("pending_payments")} value={data?.counts.pending_payments ?? 0} prefix="₹" color="#F59E0B" onPress={() => router.push("/(tabs)/payments")} testID="metric-pending-payments" />
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Metric icon="document-text" label={t("docs_required")} value={data?.counts.documents_required ?? 0} color="#F59E0B" onPress={() => router.push("/(tabs)/documents")} testID="metric-docs-required" />
          <Metric icon="cloud-upload" label={t("docs_uploaded")} value={data?.counts.documents_uploaded ?? 0} color="#10B981" onPress={() => router.push("/(tabs)/documents")} testID="metric-docs-uploaded" />
        </View>

        {/* action center */}
        <SectionHeader title={t("action_center")} />
        {isError ? (
          <ErrorState message="Could not load dashboard" onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonList count={3} />
        ) : !data?.action_cards.length ? (
          <EmptyState icon="checkmark-done" title="All clear!" body="No pending actions right now. Explore services to get started." actionLabel={t("services")} onAction={() => router.push("/(tabs)/services")} testID="home-empty-actions" />
        ) : (
          <View style={{ gap: 10 }}>
            {data.action_cards.map((a, i) => (
              <Animated.View key={`${a.kind}-${i}`} entering={FadeInDown.delay(i * 50).springify().damping(16)}>
                <Pressable onPress={() => a.request_id && router.push(`/request/${a.request_id}`)} testID={`action-${a.kind}-${i}`}>
                  <Card glass style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <View style={[s.actionIcon, { backgroundColor: `${SEV[a.severity]}22` }]}>
                      <Icon name={actionIcon[a.kind] ?? "information-circle"} size={18} color={SEV[a.severity] ?? colors.brand} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.actionTitle}>{a.title}</Text>
                      <Text style={s.actionBody}>{a.body}</Text>
                    </View>
                    <Icon name="chevron-forward" size={16} color={colors.muted} />
                  </Card>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}

        {/* deadlines */}
        <SectionHeader title={t("deadlines")} />
        {data?.deadlines.length ? (
          <Card style={{ gap: 14 }}>
            {data.deadlines.map((d, i) => (
              <View key={d.id} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <View style={s.dateBox}>
                  <Text style={s.dateText}>{(d.due_date || "").split("-")[2] ?? "--"}</Text>
                  <Text style={s.dateMon}>{monthShort((d.due_date || "").split("-")[1])}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 13.5 }} numberOfLines={1}>{d.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11.5, textTransform: "capitalize" }}>{d.kind}</Text>
                </View>
                {i === 0 ? <StatusBadge status="pending" label={t("deadline_approaching")} /> : null}
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Text style={{ color: colors.muted, textAlign: "center" }}>No upcoming deadlines</Text>
          </Card>
        )}

        {/* recent requests */}
        <SectionHeader title={t("my_requests")} actionLabel={t("view_all")} onAction={() => router.push("/(tabs)/services")} />
        {data?.recent_requests.length ? (
          <View style={{ gap: 10 }}>
            {data.recent_requests.map((r) => (
              <Pressable key={r.id} onPress={() => router.push(`/request/${r.id}`)} testID={`recent-request-${r.id}`}>
                <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ gap: 3, flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "700" }} numberOfLines={1}>{r.service_name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{r.fy}</Text>
                  </View>
                  <StatusBadge status={r.status} />
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* business sheet */}
      {bizSheet && (
        <View style={[s.sheetOverlay]}>
          <Pressable style={{ flex: 1 }} onPress={() => setBizSheet(false)} />
          <Animated.View entering={FadeInDown.springify().damping(18)} style={s.sheet}>
            <Text style={s.sheetTitle}>{t("businesses")}</Text>
            {businesses.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => {
                  setBusinessId(b.id);
                  setBizSheet(false);
                }}
                style={[s.sheetItem, b.id === businessId && { borderColor: colors.brandPrimary }]}
                testID={`business-option-${b.name}`}
              >
                <Icon name="business" size={18} color={colors.brand} />
                <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{b.name}</Text>
                {b.id === businessId ? <Icon name="checkmark" size={18} color={colors.brand} /> : null}
              </Pressable>
            ))}
            <Button label={t("add_business")} icon="add" onPress={() => { setBizSheet(false); router.push("/(tabs)/profile"); }} testID="home-add-business" />
          </Animated.View>
        </View>
      )}

      {/* FY sheet */}
      {fySheet && (
        <View style={[s.sheetOverlay]}>
          <Pressable style={{ flex: 1 }} onPress={() => setFySheet(false)} />
          <Animated.View entering={FadeInDown.springify().damping(18)} style={s.sheet}>
            <Text style={s.sheetTitle}>{t("financial_year")}</Text>
            {fyList.map((f) => (
              <Pressable
                key={f}
                onPress={() => {
                  setFy(f);
                  setFySheet(false);
                }}
                style={[s.sheetItem, f === fy && { borderColor: colors.brandPrimary }]}
                testID={`fy-option-${f}`}
              >
                <Icon name="calendar" size={18} color={colors.brand} />
                <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{f}</Text>
                {f === fy ? <Icon name="checkmark" size={18} color={colors.brand} /> : null}
              </Pressable>
            ))}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.md },
  greeting: { color: colors.muted, fontSize: 13 },
  name: { color: colors.onSurface, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  bell: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.divider, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: -4, right: -4, backgroundColor: colors.error, minWidth: 17, height: 17, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  cardLabel: { color: colors.onSurfaceTertiary, fontSize: 12.5, fontWeight: "700" },
  switcher: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: 12, minHeight: 44 },
  switcherText: { color: colors.onSurface, fontWeight: "700", fontSize: 13, flex: 1 },
  actionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  actionBody: { color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 17 },
  dateBox: { width: 44, height: 48, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  dateText: { color: colors.onSurface, fontWeight: "800", fontSize: 15 },
  dateMon: { color: colors.muted, fontSize: 9.5, fontWeight: "700", textTransform: "uppercase" },
  sheetOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(2,6,23,0.65)", zIndex: 50 },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: 10 },
  sheetTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800", marginBottom: 4 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, padding: 14, backgroundColor: colors.surfaceTertiary },
}));
