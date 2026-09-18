// Document review: approve/reject/re-upload + audited manual unlock + staff download.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api, fileUrl } from "@/src/api";
import { Button, Card, ChipRow, EmptyState, ErrorState, Input, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Doc = {
  id: string; name: string; filename: string; status: string; client_id: string; request_id: string | null;
  client?: { id: string; name: string; client_code: string } | null;
};

const FILTERS = [
  { key: "uploaded", label: "To Review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "", label: "All" },
];

export default function AdminDocuments() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const { show } = useToast();
  const [filter, setFilter] = useState("uploaded");
  const [actionDoc, setActionDoc] = useState<Doc | null>(null);
  const [note, setNote] = useState("");
  const [unlockSheet, setUnlockSheet] = useState<Doc | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{ documents: Doc[] }>({
    queryKey: ["admin-documents", filter],
    queryFn: () => api(`/admin/documents${filter ? `?status=${filter}` : ""}`),
  });

  const review = useMutation({
    mutationFn: (vars: { id: string; action: string; note: string }) => api(`/admin/documents/${vars.id}/review`, { method: "POST", body: { action: vars.action, note: vars.note } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-documents"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      show("Document status updated", "success");
      setActionDoc(null);
      setNote("");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Review failed", "error"),
  });

  const unlock = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => api(`/admin/documents/${vars.id}/unlock`, { method: "POST", body: { reason: vars.reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-documents"] });
      show("Access unlocked (audit logged)", "success");
      setUnlockSheet(null);
      setReason("");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Unlock failed", "error"),
  });

  const download = async (d: Doc) => {
    try {
      const url = await fileUrl(d.id, "download");
      if (typeof window !== "undefined" && typeof window.open === "function") window.open(url, "_blank");
    } catch (e) {
      show(e instanceof Error ? e.message : "Download failed", "error");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + 12 }} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Document Review</Text>
      <View style={{ marginVertical: 8 }}>
        <ChipRow items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} value={filter} onChange={setFilter} testPrefix="doc-filter" />
      </View>

      {isError ? (
        <ErrorState message="Could not load documents" onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonList count={3} />
      ) : !data?.documents.length ? (
        <EmptyState icon="folder" title="No documents" body={filter === "uploaded" ? "Nothing waiting for review." : undefined} testID="admin-docs-empty" />
      ) : (
        <View style={{ gap: 12, paddingBottom: 40 }}>
          {data.documents.map((d, i) => (
            <Animated.View key={d.id} entering={FadeInDown.delay(i * 40).springify().damping(15)}>
              <Card style={{ gap: 10 }} testID={`admin-doc-${d.id}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{d.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{d.client?.name} · {d.client?.client_code} · {d.filename}</Text>
                  </View>
                  <StatusBadge status={d.status} />
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button label="Approve" icon="checkmark" onPress={() => review.mutate({ id: d.id, action: "approve", note: note })} testID={`approve-${d.id}`} style={{ flex: 1 }} />
                  <Button label="Reject" variant="ghost" onPress={() => setActionDoc(d)} testID={`open-reject-${d.id}`} style={{ flex: 0.8 }} />
                  <Button label="Re-upload" variant="ghost" onPress={() => review.mutate({ id: d.id, action: "reupload_required", note: note })} testID={`reupload-${d.id}`} style={{ flex: 1 }} />
                  <Button label="Unlock" variant="ghost" onPress={() => setUnlockSheet(d)} testID={`unlock-${d.id}`} style={{ flex: 0.8 }} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>Downloads by staff are access-logged.</Text>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <Sheet visible={!!actionDoc} onClose={() => setActionDoc(null)} title={`Reject "${actionDoc?.name ?? ""}"`}>
        <View style={{ gap: 12, paddingBottom: 20 }}>
          <Input label="Reason (shared with client)" value={note} onChangeText={setNote} multiline testID="doc-reject-note" />
          <Button label="Reject Document" variant="danger" onPress={() => actionDoc && review.mutate({ id: actionDoc.id, action: "reject", note })} loading={review.isPending} testID="doc-reject-confirm" />
        </View>
      </Sheet>

      <Sheet visible={!!unlockSheet} onClose={() => setUnlockSheet(null)} title={`Manual unlock — ${unlockSheet?.name ?? ""}`}>
        <View style={{ gap: 12, paddingBottom: 20 }}>
          <Input label="Reason (audited, required)" value={reason} onChangeText={setReason} multiline testID="unlock-reason" placeholder="e.g. Client paid offline before portal switch" />
          <Button label="Unlock Access" variant="danger" onPress={() => unlockSheet && unlock.mutate({ id: unlockSheet.id, reason })} loading={unlock.isPending} testID="unlock-confirm" />
        </View>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
}));
