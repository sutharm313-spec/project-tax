// Staff ticket inbox with reply + status control.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, ErrorState, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Ticket = { id: string; subject: string; category: string; priority: string; status: string; updated_at: string; client?: { name: string; client_code: string } | null };

const FILTERS = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting_for_client", label: "Waiting" },
  { key: "resolved", label: "Resolved" },
];

export default function AdminTickets() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const list = useQuery<{ tickets: Ticket[] }>({
    queryKey: ["admin-tickets", filter],
    queryFn: () => api(`/admin/tickets${filter ? `?status=${filter}` : ""}`),
  });

  const detail = useQuery<{ ticket: Ticket; messages: { id: string; sender: string; sender_name: string; body: string; created_at: string }[] }>({
    queryKey: ["admin-ticket", openId],
    queryFn: () => api(`/admin/tickets/${openId}`),
    enabled: !!openId,
  });

  const reply_ = useMutation({
    mutationFn: (vars: { id: string; body: string; status?: string }) => api(`/admin/tickets/${vars.id}/messages`, { method: "POST", body: { body: vars.body, status: vars.status } }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["admin-ticket", openId] });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
      show("Reply sent", "success");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not send", "error"),
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Support Tickets</Text>
      <View style={{ marginVertical: 8 }}>
        <ChipRow items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} value={filter} onChange={setFilter} testPrefix="ticket-filter" />
      </View>

      {list.isError ? (
        <ErrorState message="Could not load tickets" onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <SkeletonList count={3} />
      ) : !list.data?.tickets.length ? (
        <EmptyState icon="headset" title="No tickets" testID="admin-tickets-empty" />
      ) : (
        <View style={{ gap: 10, paddingBottom: 40 }}>
          {list.data.tickets.map((tk, i) => (
            <Animated.View key={tk.id} entering={FadeInDown.delay(Math.min(i, 8) * 35).springify().damping(15)}>
              <Pressable onPress={() => setOpenId(tk.id)} testID={`admin-ticket-${tk.id}`}>
                <Card style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800", flex: 1 }}>{tk.subject}</Text>
                    <StatusBadge status={tk.status} />
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{tk.client?.name} · {tk.client?.client_code} · {tk.priority}</Text>
                </Card>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={!!openId} onClose={() => setOpenId(null)} title={detail.data?.ticket.subject ?? "Ticket"}>
        <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 10, paddingBottom: 30 }}>
            {detail.data?.messages.map((m) => (
              <View key={m.id} style={{ alignSelf: m.sender === "staff" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                <View style={[s.bubble, m.sender === "staff" ? { backgroundColor: colors.brandPrimary } : { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.divider }]}>
                  <Text style={{ color: m.sender === "staff" ? "#FFF" : colors.onSurface, fontSize: 13.5 }}>{m.body}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 10, marginTop: 3 }}>{m.sender_name}</Text>
              </View>
            ))}
            <Input value={reply} onChangeText={setReply} placeholder="Type a reply…" multiline testID="admin-ticket-reply" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button label="Send reply" icon="send" onPress={() => reply.trim() && reply_.mutate({ id: openId!, body: reply })} loading={reply_.isPending} testID="admin-ticket-send" style={{ flex: 1 }} />
              <Button label="Resolve" variant="ghost" onPress={() => reply_.mutate({ id: openId!, body: reply || "Ticket resolved", status: "resolved" })} testID="admin-ticket-resolve" style={{ flex: 0.8 }} />
            </View>
          </View>
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  bubble: { borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 9 },
}));
