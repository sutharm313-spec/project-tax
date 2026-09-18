// Service request detail: timeline, document checklist (upload always free),
// payment card with UPI sheet, workspace info, cancel.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api, apiUpload, fileUrl } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { pickFromCamera, pickFromFiles, pickFromGallery } from "@/src/upload";
import { UpiSheet } from "@/src/upi-sheet";
import { Button, Card, EmptyState, ErrorState, Icon, Input, Sheet, Skeleton, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Req = {
  id: string; service_name: string; category: string; fy: string; price: number; status: string; payment_status: string;
  checklist: { key: string; name: string; required: boolean; instructions: string; status: string; document_id: string | null }[];
  workspace: Record<string, unknown>; notes: string;
};
type Detail = {
  request: Req;
  documents: { id: string; name: string; status: string; locked: boolean; ext: string; checklist_key: string | null }[];
  invoice: { id: string; number: string; total: number; status: string } | null;
  payment: { id: string; status: string; utr: string | null; rejection_reason?: string } | null;
  business: { id: string; name: string; gstin?: string } | null;
  assigned_staff: { id: string; name: string } | null;
  timeline: { step: string; label: string; done: boolean; current: boolean }[];
};

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [uploadItem, setUploadItem] = useState<{ key: string | null; name: string } | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  const { data, isLoading, isError, refetch } = useQuery<Detail>({
    queryKey: ["request", id],
    queryFn: () => api(`/client/requests/${id}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["request", id] });
    qc.invalidateQueries({ queryKey: ["overview"] });
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const upload = useMutation({
    mutationFn: async (file: { uri: string; name: string; mimeType: string } | null) => {
      const item = uploadItem;
      setUploadItem(null);
      if (!file || !item) return;
      return apiUpload("/client/documents", {
        request_id: id as string, checklist_key: item.key ?? "", doc_name: item.name, fy: data?.request.fy ?? "",
      }, file, setUploadPct);
    },
    onSuccess: () => {
      setUploadPct(0);
      show("Document uploaded securely", "success");
      invalidate();
    },
    onError: (e) => {
      setUploadPct(0);
      show(e instanceof Error ? e.message : "Upload failed", "error");
    },
  });

  const cancel = useMutation({
    mutationFn: () => api(`/client/requests/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      show("Request cancelled", "info");
      invalidate();
      router.back();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not cancel", "error"),
  });

  const openDoc = async (docId: string, action: "view" | "download") => {
    try {
      const url = await fileUrl(docId, action);
      if (typeof window !== "undefined" && typeof window.open === "function") window.open(url, "_blank");
      else await import("react-native").then((RN) => RN.Linking.openURL(url));
    } catch (e) {
      show(e instanceof Error ? e.message : "Access denied", "error");
    }
  };

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top + 16, padding: spacing.lg, gap: 14 }]}>
        <Skeleton width="60%" height={22} />
        <Skeleton width="100%" height={100} />
        <Skeleton width="100%" height={180} />
      </View>
    );
  }
  if (isError || !data) {
    return (
      <View style={[s.root, { paddingTop: insets.top + 16 }]}>
        <ErrorState message="Could not load request" onRetry={() => refetch()} />
      </View>
    );
  }

  const { request: req, invoice, documents, timeline, business, payment } = data;
  const unpaid = req.payment_status !== "verified" && req.status !== "cancelled";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} testID="request-back" accessibilityRole="button">
          <Icon name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ color: colors.onSurface, fontWeight: "800" }} numberOfLines={1}>{req.service_name}</Text>
          <Text style={{ color: colors.muted, fontSize: 11.5 }}>{business?.name} · {req.fy}</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 150, gap: 16 }} showsVerticalScrollIndicator={false}>
        {/* status + price */}
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <StatusBadge status={req.status} />
            <Text style={s.price}>₹{req.price.toLocaleString("en-IN")}</Text>
          </View>
          {unpaid && invoice ? (
            <>
              <Button label={`${t("pay_now")} · ₹${invoice.total.toLocaleString("en-IN")}`} icon="card" onPress={() => setPayOpen(true)} testID="request-pay-btn" />
              <Text style={{ color: colors.muted, fontSize: 11.5, textAlign: "center" }}>Upload documents now — pay anytime. View & download unlock after verification.</Text>
            </>
          ) : null}
          {req.payment_status === "verified" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="checkmark-circle" size={18} color={colors.success} />
              <Text style={{ color: colors.success, fontWeight: "700", fontSize: 13 }}>{t("payment_verified")} — documents unlocked</Text>
            </View>
          ) : null}
          {payment?.status === "submitted" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="hourglass" size={18} color={colors.warning} />
              <Text style={{ color: colors.warning, fontWeight: "700", fontSize: 13 }}>{t("under_verification")} · UPI Ref {payment.utr}</Text>
            </View>
          ) : null}
          {payment?.status === "rejected" && payment.rejection_reason ? (
            <Text style={{ color: colors.error, fontSize: 12.5 }}>Payment rejected: {payment.rejection_reason}. Please pay again.</Text>
          ) : null}
        </Card>

        {/* timeline */}
        <View style={{ gap: 8 }}>
          <Text style={s.section}>{t("timeline")}</Text>
          <Card style={{ gap: 0 }}>
            {timeline.map((step, i) => (
              <View key={step.step} style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ alignItems: "center" }}>
                  <View style={[s.tlDot, step.done && { backgroundColor: colors.success }, step.current && !step.done && { backgroundColor: colors.brandPrimary }]}>
                    <Icon name={step.done ? "checkmark" : step.current ? "time" : "ellipse-outline"} size={12} color="#FFF" />
                  </View>
                  {i < timeline.length - 1 ? <View style={[s.tlLine, i < timeline.slice(0, i + 1).filter((x) => x.done).length && { backgroundColor: colors.success }]} /> : null}
                </View>
                <View style={{ paddingBottom: 18, flex: 1, paddingTop: 2 }}>
                  <Text style={{ color: step.done || step.current ? colors.onSurface : colors.muted, fontWeight: step.done ? "800" : "600", fontSize: 13.5 }}>{step.label}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        {/* checklist */}
        <View style={{ gap: 8 }}>
          <Text style={s.section}>{t("required_docs")}</Text>
          <View style={{ gap: 10 }}>
            {req.checklist.map((item, i) => {
              const doc = documents.find((d) => d.id === item.document_id);
              return (
                <Animated.View key={item.key + i} entering={FadeInDown.delay(i * 40).springify().damping(15)}>
                  <Card style={{ gap: 10 }} testID={`checklist-${item.key}`}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{item.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                          {item.required ? t("required") : t("optional")} · {item.status.replace(/_/g, " ")}
                        </Text>
                      </View>
                      <StatusBadge status={item.status} />
                    </View>
                    {item.instructions ? <Text style={{ color: colors.muted, fontSize: 12 }}>{item.instructions}</Text> : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Button label={item.status === "required" || item.status === "reupload_required" ? t("upload_doc") : t("replace")} icon="cloud-upload" variant="soft" onPress={() => setUploadItem({ key: item.key, name: item.name })} testID={`upload-${item.key}`} style={{ flex: 1 }} />
                      {doc ? (
                        <>
                          <Button label={doc.locked ? `🔒 ${t("view")}` : `👁 ${t("view")}`} variant="ghost" onPress={() => openDoc(doc.id, "view")} disabled={doc.locked} testID={`view-${item.key}`} style={{ flex: 0.9 }} />
                          <Button label={doc.locked ? `🔒 ${t("download")}` : `⬇ ${t("download")}`} variant="ghost" onPress={() => openDoc(doc.id, "download")} disabled={doc.locked} testID={`download-${item.key}`} style={{ flex: 0.9 }} />
                        </>
                      ) : null}
                    </View>
                  </Card>
                </Animated.View>
              );
            })}
            {/* extra docs uploaded without checklist key */}
            {documents.filter((d) => !d.checklist_key).map((d) => (
              <Card key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Icon name="document-attach" size={18} color={colors.brand} />
                <Text style={{ color: colors.onSurface, flex: 1, fontWeight: "700" }} numberOfLines={1}>{d.name}</Text>
                <StatusBadge status={d.status} />
                <Button label={d.locked ? "🔒" : "👁"} variant="ghost" onPress={() => openDoc(d.id, "view")} disabled={d.locked} testID={`view-extra-${d.id}`} />
              </Card>
            ))}
          </View>
        </View>

        {/* assigned staff */}
        {data.assigned_staff ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[s.staffAvatar]}>
              <Icon name="person" size={18} color="#93C5FD" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{data.assigned_staff.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 11.5 }}>Assigned to your request</Text>
            </View>
          </Card>
        ) : null}

        {/* ITR workspace info (client-editable income details) */}
        {req.category === "income_tax" && req.payment_status === "verified" ? (
          <View style={{ gap: 8 }}>
            <Text style={s.section}>Income Details</Text>
            <Card style={{ gap: 10 }}>
              {["salary", "business_income", "capital_gains", "other_income", "deductions"].map((k) => (
                <View key={k} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.onSurfaceSecondary, textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</Text>
                  <Text style={{ color: colors.onSurface, fontWeight: "700" }}>₹{Number(req.workspace?.[k] ?? 0).toLocaleString("en-IN")}</Text>
                </View>
              ))}
              <Text style={{ color: colors.muted, fontSize: 11.5 }}>Shared with your tax professional for preparation.</Text>
            </Card>
          </View>
        ) : null}

        {req.status !== "cancelled" && req.payment_status !== "verified" ? (
          <Button label={t("cancel")} variant="ghost" onPress={() => cancel.mutate()} testID="request-cancel" />
        ) : null}
      </ScrollView>

      {/* upload source sheet */}
      <Sheet visible={!!uploadItem} onClose={() => setUploadItem(null)} title={`${t("upload_doc")} — ${uploadItem?.name ?? ""}`}>
        <View style={{ gap: 10, paddingBottom: 12 }}>
          <Button label={t("camera")} icon="camera" variant="ghost" onPress={() => pickFromCamera().then((f) => upload.mutate(f))} testID="pick-camera" />
          <Button label={t("gallery")} icon="images" variant="ghost" onPress={() => pickFromGallery().then((f) => upload.mutate(f))} testID="pick-gallery" />
          <Button label={t("files")} icon="folder" variant="ghost" onPress={() => pickFromFiles().then((f) => upload.mutate(f))} testID="pick-files" />
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>PDF · JPG · PNG · XLS · DOC · ZIP — max 25 MB</Text>
        </View>
      </Sheet>

      <UpiSheet invoiceId={invoice && unpaid ? invoice.id : null} visible={payOpen} onClose={() => setPayOpen(false)} testID="request-upi" />

      {uploadPct > 0 ? (
        <View style={[s.progressWrap]} testID="request-upload-progress">
          <Text style={{ color: colors.onSurface, fontSize: 12, fontWeight: "700" }}>Uploading… {uploadPct}%</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: 12, gap: 10 },
  price: { color: colors.onSurface, fontWeight: "800", fontSize: 18 },
  section: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  tlDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.borderStrong, alignItems: "center", justifyContent: "center", zIndex: 1 },
  tlLine: { width: 2, height: 22, backgroundColor: colors.borderStrong },
  staffAvatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  progressWrap: { position: "absolute", left: 16, right: 16, bottom: 120, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.brand },
}));
