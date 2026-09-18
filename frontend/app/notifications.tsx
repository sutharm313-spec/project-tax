// Notification center with read/unread state.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { Card, EmptyState, ErrorState, Icon, SkeletonList, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Notif = { id: string; title: string; body: string; kind: string; read: boolean; created_at: string };

const KIND_COLOR: Record<string, string> = { success: "#10B981", warning: "#F59E0B", error: "#EF4444", info: "#3B82F6" };

export default function Notifications() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<{ notifications: Notif[] }>({
    queryKey: ["notifications"],
    queryFn: () => api("/client/notifications"),
  });

  const readAll = useMutation({
    mutationFn: () => api("/client/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      show(t("mark_all_read"), "success");
    },
  });

  const readOne = useMutation({
    mutationFn: (id: string) => api(`/client/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.title}>{t("notifications")}</Text>
        <Pressable onPress={() => readAll.mutate()} testID="notifications-read-all">
          <Text style={{ color: colors.brand, fontWeight: "700" }}>{t("mark_all_read")}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24, gap: 10 }} showsVerticalScrollIndicator={false}>
        {isError ? (
          <ErrorState message="Could not load notifications" onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonList count={4} />
        ) : !data?.notifications.length ? (
          <EmptyState icon="notifications-off" title={t("empty_notifications")} testID="notifications-empty" />
        ) : (
          data.notifications.map((n, i) => (
            <Animated.View key={n.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).springify().damping(15)}>
              <Pressable onPress={() => !n.read && readOne.mutate(n.id)} testID={`notification-${n.id}`}>
                <Card style={{ flexDirection: "row", gap: 12, opacity: n.read ? 0.65 : 1 }}>
                  <View style={[s.kindDot, { backgroundColor: `${KIND_COLOR[n.kind] ?? colors.info}22` }]}>
                    <Icon name={n.kind === "success" ? "checkmark-circle" : n.kind === "error" ? "alert-circle" : n.kind === "warning" ? "warning" : "information-circle"} size={18} color={KIND_COLOR[n.kind] ?? colors.info} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: n.read ? "600" : "800" }}>{n.title}</Text>
                    <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 18 }}>{n.body}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10.5 }}>{new Date(n.created_at).toLocaleString("en-IN")}</Text>
                  </View>
                  {!n.read ? <View style={[s.unread, { backgroundColor: colors.brandPrimary }]} /> : null}
                </Card>
              </Pressable>
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: 16, paddingBottom: 10 },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  kindDot: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  unread: { width: 8, height: 8, borderRadius: 4, alignSelf: "center" },
}));
