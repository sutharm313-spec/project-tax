// Secure document vault: status filters, upload FAB (camera/gallery/files),
// lock badges — view/download only after verified payment (server-enforced).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api, apiUpload, fileUrl } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useClientApp } from "@/src/app-context";
import { pickFromCamera, pickFromFiles, pickFromGallery, type PickedFile } from "@/src/upload";
import { Button, Card, ChipRow, EmptyState, ErrorState, Icon, Sheet, SkeletonList, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";

type Doc = { id: string; name: string; filename: string; status: string; locked: boolean; request_id: string | null; fy: string | null; size: number; ext: string; versions_count: number };

const EXT_ICON: Record<string, string> = { pdf: "document", jpg: "image", jpeg: "image", png: "image", xls: "grid", xlsx: "grid", doc: "document-text", docx: "document-text", zip: "file-tray-full" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "under_review", label: "Under Review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export default function Documents() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToast();
  const { businessId, fy } = useClientApp();
  const [filter, setFilter] = useState("all");
  const [uploadSheet, setUploadSheet] = useState(false);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [pct, setPct] = useState(0);

  const { data, isLoading, isError, refetch } = useQuery<{ documents: Doc[] }>({
    queryKey: ["documents", businessId, fy],
    queryFn: () => api(`/client/documents?${businessId ? `business_id=${businessId}&` : ""}fy=${encodeURIComponent(fy)}`),
  });

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const docs = useMemo(() => (data?.documents ?? []).filter((d) => filter === "all" || d.status === filter), [data, filter]);

  const doUpload = async (file: PickedFile | null) => {
    setUploadSheet(false);
    if (!file) return;
    setPct(1);
    try {
      await apiUpload("/client/documents", { business_id: businessId ?? "", fy }, file, setPct);
      show("Document uploaded securely", "success");
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    } catch (e) {
      show(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setPct(0);
    }
  };

  const openDoc = async (doc: Doc, action: "view" | "download") => {
    setBusyDoc(doc.id + action);
    try {
      const url = await fileUrl(doc.id, action);
      if (typeof window !== "undefined" && typeof window.open === "function") window.open(url, "_blank");
      else await Linking.openURL(url);
    } catch (e) {
      show(e instanceof Error ? e.message : "Access denied", "error");
    } finally {
      setBusyDoc(null);
    }
  };

  const replaceDoc = async (doc: Doc) => {
    try {
      const file = await pickFromFiles();
      if (!file) return;
      await apiUpload(`/client/documents/${doc.id}/replace`, {}, file, undefined);
      show("New version uploaded", "success");
      qc.invalidateQueries({ queryKey: ["documents"] });
    } catch (e) {
      show(e instanceof Error ? e.message : "Replace failed", "error");
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.title}>{t("documents")}</Text>
        <Text style={s.hint}>{t("upload_locked_hint")}</Text>
      </View>

      <ChipRow items={FILTERS} value={filter} onChange={setFilter} testPrefix="doc-filter" />

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomChrome + 110 }} showsVerticalScrollIndicator={false}>
        {isError ? (
          <ErrorState message="Could not load documents" onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonList count={4} />
        ) : !docs.length ? (
          <EmptyState icon="folder-open" title={t("empty_docs")} body={t("empty_docs_body")} actionLabel={t("upload_doc")} onAction={() => setUploadSheet(true)} testID="documents-empty" />
        ) : (
          <View style={{ gap: 12 }}>
            {docs.map((d, i) => (
              <Animated.View key={d.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).springify().damping(16)}>
                <Card style={{ gap: 10 }} testID={`doc-card-${d.name}`}>
                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <View style={[s.extIcon, { backgroundColor: "rgba(59,130,246,0.14)" }]}>
                      <Icon name={EXT_ICON[d.ext] ?? "document"} size={20} color="#3B82F6" />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.docName} numberOfLines={1}>{d.name}</Text>
                      <Text style={s.docMeta}>{d.fy ?? ""} {d.versions_count > 1 ? `· v${d.versions_count}` : ""} · {(d.size / 1024).toFixed(0)} KB</Text>
                    </View>
                    <StatusBadge status={d.status} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      testID={`doc-view-${d.id}`}
                      disabled={d.locked}
                      onPress={() => openDoc(d, "view")}
                      style={[s.docBtn, { flex: 1 }, d.locked && { opacity: 0.5 }]}
                    >
                      <Icon name={d.locked ? "lock-closed" : "eye"} size={15} color={d.locked ? "#F59E0B" : "#93C5FD"} />
                      <Text style={[s.docBtnText, { color: d.locked ? "#F59E0B" : "#93C5FD" }]}>{d.locked ? t("locked") : t("view")}</Text>
                    </Pressable>
                    <Pressable
                      testID={`doc-download-${d.id}`}
                      disabled={d.locked}
                      onPress={() => openDoc(d, "download")}
                      style={[s.docBtn, { flex: 1 }, d.locked && { opacity: 0.5 }]}
                    >
                      <Icon name={d.locked ? "lock-closed" : "download"} size={15} color={d.locked ? "#F59E0B" : "#10B981"} />
                      <Text style={[s.docBtnText, { color: d.locked ? "#F59E0B" : "#10B981" }]}>{d.locked ? t("locked") : t("download")}</Text>
                    </Pressable>
                    <Pressable testID={`doc-replace-${d.id}`} onPress={() => replaceDoc(d)} style={[s.docBtn, { flex: 0.7 }]}>
                      <Icon name="sync" size={15} color={colors.onSurfaceTertiary} />
                      <Text style={[s.docBtnText, { color: colors.onSurfaceTertiary }]}>{t("replace")}</Text>
                    </Pressable>
                  </View>
                </Card>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* upload FAB */}
      <Pressable testID="upload-fab" onPress={() => setUploadSheet(true)} style={[s.fab, { bottom: bottomChrome + 16 }]}>
        <Icon name="cloud-upload" size={22} color="#FFF" />
        <Text style={{ color: "#FFF", fontWeight: "800" }}>{t("upload_doc")}</Text>
      </Pressable>

      {pct > 0 ? (
        <View style={[s.progressWrap, { bottom: bottomChrome + 84 }]} testID="upload-progress">
          <Text style={{ color: colors.onSurface, fontSize: 12, fontWeight: "700" }}>Uploading… {pct}%</Text>
        </View>
      ) : null}

      <Sheet visible={uploadSheet} onClose={() => setUploadSheet(false)} title={t("upload_doc")}>
        <View style={{ gap: 10, paddingBottom: 12 }}>
          <Button label={t("camera")} icon="camera" onPress={() => { pickFromCamera().then(doUpload); }} variant="ghost" testID="upload-camera" />
          <Button label={t("gallery")} icon="images" onPress={() => pickFromGallery().then(doUpload)} variant="ghost" testID="upload-gallery" />
          <Button label={t("files")} icon="folder" onPress={() => pickFromFiles().then(doUpload)} variant="ghost" testID="upload-files" />
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>PDF · JPG · PNG · XLS · DOC · ZIP — max 25 MB</Text>
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, gap: 4, paddingBottom: 6 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  hint: { color: colors.muted, fontSize: 12 },
  extIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  docName: { color: colors.onSurface, fontWeight: "800", fontSize: 14.5 },
  docMeta: { color: colors.muted, fontSize: 11.5 },
  docBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surfaceTertiary },
  docBtnText: { fontWeight: "700", fontSize: 12.5 },
  fab: { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 14, shadowColor: "#2563EB", shadowOpacity: 0.45, shadowRadius: 16 },
  progressWrap: { position: "absolute", left: 16, right: 16, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.brand },
}));
