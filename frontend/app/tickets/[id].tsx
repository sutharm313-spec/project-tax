// Ticket conversation: client ↔ staff messages with auto-scroll.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import Icon from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { Input, StatusBadge } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Msg = { id: string; sender: string; sender_name: string; body: string; created_at: string };

export default function TicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ ticket: { id: string; subject: string; status: string }; messages: Msg[] }>({
    queryKey: ["ticket", id],
    queryFn: () => api(`/client/tickets/${id}`),
  });

  const send = useMutation({
    mutationFn: () => api(`/client/tickets/${id}/messages`, { method: "POST", body: { body } }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["ticket", id] });
    },
  });

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
  }, [data?.messages.length]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} testID="ticket-back" accessibilityRole="button">
          <Icon name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ color: colors.onSurface, fontWeight: "800" }} numberOfLines={1}>{data?.ticket.subject ?? t("tickets")}</Text>
          {data ? <StatusBadge status={data.ticket.status} /> : null}
        </View>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, gap: 10 }} showsVerticalScrollIndicator={false}>
          {isLoading ? <Text style={{ color: colors.muted }}>{t("loading")}</Text> : null}
          {data?.messages.map((m, i) => (
            <Animated.View key={m.id} entering={FadeInDown.springify().damping(15)} style={{ alignSelf: m.sender === "client" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
              <View style={[s.bubble, m.sender === "client" ? s.bubbleMine : s.bubbleTheirs]}>
                <Text style={{ color: m.sender === "client" ? "#FFF" : colors.onSurface, fontSize: 14, lineHeight: 20 }}>{m.body}</Text>
              </View>
              <Text style={[s.meta, { textAlign: m.sender === "client" ? "right" : "left" }]}>{m.sender_name} · {new Date(m.created_at).toLocaleString("en-IN")}</Text>
            </Animated.View>
          ))}
        </ScrollView>
        <View style={[s.inputRow, { paddingBottom: insets.bottom + 12 }]}>
          <Input value={body} onChangeText={setBody} placeholder={t("reply")} testID="ticket-reply-input" style={{ flex: 1 }} />
          <Pressable onPress={() => body.trim() && send.mutate()} disabled={send.isPending} style={s.sendBtn} testID="ticket-send">
            <Icon name="send" size={20} color="#FFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  bubble: { borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: colors.surfaceTertiary, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.divider },
  meta: { color: colors.muted, fontSize: 10.5, marginTop: 4 },
  inputRow: { flexDirection: "row", gap: 10, paddingHorizontal: spacing.lg, paddingTop: 10, alignItems: "flex-end" },
  sendBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
}));
