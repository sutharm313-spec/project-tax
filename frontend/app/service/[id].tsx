// Service detail: description, price, required docs, flow explainer, request CTA.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useClientApp } from "@/src/app-context";
import { Button, Card, EmptyState, Icon, Skeleton, StatusBadge, useToast } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Service = {
  id: string; name: string; category: string; description: string;
  estimated_days: number; required_docs: { key: string; name: string; required: boolean }[];
};
type PriceInfo = { assigned: boolean; amount: number | null; fy: string; ay: string; currency: string };

const STEPS = ["step_upload", "step_pay", "step_verify", "step_work"];

export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { businessId, fy, businesses } = useClientApp();
  const { show } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError } = useQuery<{ service: Service }>({
    queryKey: ["catalog", id],
    queryFn: () => api(`/catalog/${id}`),
  });

  const { data: priceData, isLoading: priceLoading } = useQuery<PriceInfo>({
    queryKey: ["client-price", id, fy],
    queryFn: () => api(`/client/price?service_id=${id}&fy=${encodeURIComponent(fy)}`),
    enabled: !!id && !!fy,
  });

  const request = useMutation({
    mutationFn: () => api<{ request: { id: string } }>("/client/requests", { method: "POST", body: { service_id: id, business_id: businessId, fy } }),
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ["overview"] });
      show("Request created — upload your documents", "success");
      router.replace(`/request/${res.request.id}`);
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not create request", "error"),
  });

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top + 16, padding: spacing.lg, gap: 14 }]}>
        <Skeleton width="40%" height={20} />
        <Skeleton width="100%" height={120} />
        <Skeleton width="70%" height={16} />
      </View>
    );
  }
  if (isError || !data?.service) {
    return (
      <View style={[s.root, { paddingTop: insets.top + 16 }]}>
        <EmptyState icon="cloud-offline" title="Service not found" actionLabel={t("back")} onAction={() => router.back()} />
      </View>
    );
  }

  const svc = data.service;
  const assigned = priceData?.assigned;
  const amount = priceData?.amount ?? null;
  const priceText = assigned && amount != null ? `₹${amount.toLocaleString("en-IN")}` : t("price_not_assigned");

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} testID="service-back" accessibilityRole="button">
          <Icon name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "700" }}>{t("service_details")}</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 140, gap: 16 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.springify().damping(16)}>
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.name}>{svc.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, textTransform: "capitalize" }}>{svc.category.replace(/_/g, " ")}</Text>
              </View>
              <View style={[s.priceBox, !assigned && { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border }]} testID="service-price-box">
                {priceLoading ? (
                  <Skeleton width={70} height={20} />
                ) : assigned ? (
                  <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: 18 }}>₹{amount!.toLocaleString("en-IN")}</Text>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Icon name="lock-closed" size={13} color={colors.muted} />
                    <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>{t("private_price")}</Text>
                  </View>
                )}
              </View>
            </View>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 20 }}>{svc.description}</Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="time" size={14} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 12 }}>{svc.estimated_days} days</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="business" size={14} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 12 }}>{businesses.find((b) => b.id === businessId)?.name ?? "—"}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="calendar" size={14} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fy}{priceData?.ay ? ` · ${priceData.ay}` : ""}</Text>
              </View>
            </View>
          </Card>
        </Animated.View>

        <View style={{ gap: 8 }}>
          <Text style={s.section}>{t("what_happens_next")}</Text>
          {STEPS.map((step, i) => (
            <Animated.View key={step} entering={FadeInDown.delay(i * 60).springify().damping(15)}>
              <Card style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <View style={[s.stepNum, { backgroundColor: colors.brandTertiary }]}>
                  <Text style={{ color: colors.onBrandTertiary, fontWeight: "800" }}>{i + 1}</Text>
                </View>
                <Text style={{ color: colors.onSurface, fontWeight: "600", flex: 1 }}>{t(step)}</Text>
                {i === 0 ? <StatusBadge status="pending" label="Free" /> : null}
              </Card>
            </Animated.View>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <Text style={s.section}>{t("required_docs")}</Text>
          <Card style={{ gap: 10 }}>
            {svc.required_docs.length ? (
              svc.required_docs.map((d) => (
                <View key={d.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Icon name={d.required ? "checkbox" : "checkbox-outline"} size={17} color={d.required ? colors.brand : colors.muted} />
                  <Text style={{ color: colors.onSurface, flex: 1, fontWeight: "600" }}>{d.name}</Text>
                  <Text style={{ color: d.required ? colors.warning : colors.muted, fontSize: 11, fontWeight: "700" }}>{d.required ? t("required") : t("optional")}</Text>
                </View>
              ))
            ) : (
              <Text style={{ color: colors.muted }}>No specific documents required — start right away.</Text>
            )}
          </Card>
        </View>
      </ScrollView>

      <View style={[s.ctaWrap, { bottom: insets.bottom + 16 }]}>
        {assigned ? (
          <>
            <Button label={`${t("request_service")} · ${priceText}`} icon="arrow-forward" loading={request.isPending || busy} onPress={() => request.mutate()} testID="request-service-btn" />
            <Text style={{ color: colors.muted, fontSize: 11.5, textAlign: "center" }}>Documents can be uploaded before payment</Text>
          </>
        ) : (
          <>
            <Button label={t("contact_for_pricing")} icon="chatbubble-ellipses" variant="soft" onPress={() => router.push("/tickets")} testID="contact-pricing-btn" />
            <Text style={{ color: colors.muted, fontSize: 11.5, textAlign: "center" }}>{t("price_not_assigned_hint")}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: 12 },
  name: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.4, flexShrink: 1 },
  priceBox: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10 },
  section: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  stepNum: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  ctaWrap: { position: "absolute", left: 0, right: 0, paddingHorizontal: spacing.lg, gap: 8 },
}));
