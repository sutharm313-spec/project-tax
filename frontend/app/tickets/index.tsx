// Support tickets list + create sheet.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { Button, Card, EmptyState, ErrorState, Input, SkeletonList, Sheet, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Ticket = { id: string; subject: string; category: string; priority: string; status: string; updated_at: string };

const CATEGORIES = ["general", "income_tax", "gst", "accounting", "tds_tcs", "audit", "registration"];

export default function Tickets() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", category: "general", description: "", priority: "normal" });

  const { data, isLoading, isError, refetch } = useQuery<{ tickets: Ticket[] }>({
    queryKey: ["tickets"],
    queryFn: () => api("/client/tickets"),
  });

  const create = useMutation({
    mutationFn: () => api("/client/tickets", { method: "POST", body: form }),
    onSuccess: () => {
      setOpen(false);
      setForm({ subject: "", category: "general", description: "", priority: "normal" });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      show("Ticket created", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not create ticket", "error"),
  });

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.title}>{t("tickets")}</Text>
        <Button label={t("new_ticket")} icon="add" onPress={() => setOpen(true)} testID="new-ticket-btn" style={{ minWidth: 130 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24, gap: 10 }} showsVerticalScrollIndicator={false}>
        {isError ? (
          <ErrorState message="Could not load tickets" onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonList count={3} />
        ) : !data?.tickets.length ? (
          <EmptyState icon="headset" title={t("empty_tickets")} body={t("empty_tickets_body")} actionLabel={t("new_ticket")} onAction={() => setOpen(true)} testID="tickets-empty" />
        ) : (
          data.tickets.map((tk, i) => (
            <Animated.View key={tk.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).springify().damping(15)}>
              <Pressable onPress={() => router.push(`/tickets/${tk.id}`)} testID={`ticket-${tk.id}`}>
                <Card style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800", flex: 1 }} numberOfLines={1}>{tk.subject}</Text>
                    <StatusBadge status={tk.status} />
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11.5, textTransform: "capitalize" }}>{tk.category} · {tk.priority} · {new Date(tk.updated_at).toLocaleDateString("en-IN")}</Text>
                </Card>
              </Pressable>
            </Animated.View>
          ))
        )}
      </ScrollView>

      <Sheet visible={open} onClose={() => setOpen(false)} title={t("new_ticket")}>
        <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Input label={t("subject")} value={form.subject} onChangeText={(v) => setForm((f) => ({ ...f, subject: v }))} testID="ticket-subject" />
            <Input label={t("category")} value={form.category} onChangeText={(v) => setForm((f) => ({ ...f, category: v }))} testID="ticket-category" placeholder={CATEGORIES.join(", ")} />
            <Input label={t("description")} value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} multiline numberOfLines={4} testID="ticket-description" />
            <Input label={t("priority")} value={form.priority} onChangeText={(v) => setForm((f) => ({ ...f, priority: v }))} testID="ticket-priority" placeholder="normal / high / urgent" />
            <Button label={t("send")} icon="send" onPress={() => create.mutate()} loading={create.isPending} testID="ticket-submit" />
          </View>
        </ScrollView>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: 16, paddingBottom: 12 },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
}));
