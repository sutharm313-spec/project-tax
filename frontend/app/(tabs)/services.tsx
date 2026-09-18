// Services marketplace: search + category chips + 2-column premium grid.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useClientApp } from "@/src/app-context";
import { Card, ChipRow, EmptyState, ErrorState, Icon, Input, SkeletonList } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";

type Service = { id: string; name: string; category: string; description: string; price: number; estimated_days: number; required_docs: { key: string; name: string; required: boolean }[] };

const CATS = [
  { key: "all", labelKey: "all" as const },
  { key: "income_tax", labelKey: "income_tax" as const },
  { key: "gst", labelKey: "gst" as const },
  { key: "accounting", labelKey: "accounting" as const },
  { key: "tds_tcs", labelKey: "tds_tcs" as const },
  { key: "audit", labelKey: "audit" as const },
  { key: "business_registration", labelKey: "business_registration" as const },
];

const CAT_ICON: Record<string, string> = {
  income_tax: "receipt", gst: "pricetags", accounting: "calculator", tds_tcs: "time",
  audit: "shield-checkmark", business_registration: "rocket", custom: "sparkles",
};

export default function Services() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { businessId } = useClientApp();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{ services: Service[] }>({
    queryKey: ["catalog"],
    queryFn: () => api("/catalog"),
  });

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const filtered = useMemo(() => {
    let list = data?.services ?? [];
    if (cat !== "all") list = list.filter((s) => s.category === cat);
    if (q.trim()) list = list.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()) || s.description.toLowerCase().includes(q.trim().toLowerCase()));
    return list;
  }, [data, cat, q]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.title}>{t("services")}</Text>
        <Input
          value={q}
          onChangeText={setQ}
          placeholder={t("search_services")}
          testID="services-search"
          style={{ paddingVertical: 10 }}
        />
      </View>

      {/* category chip row — chrome, kept above the scroll content */}
      <ChipRow
        items={CATS.map((c) => ({ key: c.key, label: t(c.labelKey) }))}
        value={cat}
        onChange={setCat}
        testPrefix="service-cat"
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomChrome + 24 }} showsVerticalScrollIndicator={false}>
        {isError ? (
          <ErrorState message="Could not load services" onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonList count={4} />
        ) : !filtered.length ? (
          <EmptyState icon="search" title={t("empty_services")} body="Try a different category or search term." testID="services-empty" />
        ) : (
          <View style={s.grid}>
            {filtered.map((sv, i) => (
              <Animated.View key={sv.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).springify().damping(16)} style={{ flexShrink: 0 }}>
                <Pressable onPress={() => router.push({ pathname: "/service/[id]", params: { id: sv.id } })} testID={`service-card-${sv.name}`}>
                  <Card style={{ gap: 8, height: "100%" }}>
                    <View style={[s.catIcon, { backgroundColor: "rgba(59,130,246,0.14)" }]}>
                      <Icon name={CAT_ICON[sv.category] ?? "sparkles"} size={18} color="#3B82F6" />
                    </View>
                    <Text style={s.serviceName} numberOfLines={2}>{sv.name}</Text>
                    <Text style={s.serviceDesc} numberOfLines={2}>{sv.description}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                      <Text style={s.price}>₹{sv.price.toLocaleString("en-IN")}</Text>
                      <View style={s.days}>
                        <Icon name="time-outline" size={11} color={colors.muted} />
                        <Text style={s.daysText}>{sv.estimated_days}d</Text>
                      </View>
                    </View>
                    <View style={[s.requestBtn, { backgroundColor: colors.brandPrimary }]}>
                      <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12.5 }}>{t("request")}</Text>
                    </View>
                  </Card>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, gap: 12, paddingBottom: 4 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 4 },
  catIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  serviceName: { color: colors.onSurface, fontWeight: "800", fontSize: 14.5, minHeight: 38 },
  serviceDesc: { color: colors.muted, fontSize: 12, lineHeight: 17, minHeight: 34 },
  price: { color: colors.brand, fontWeight: "800", fontSize: 15 },
  days: { flexDirection: "row", alignItems: "center", gap: 3 },
  daysText: { color: colors.muted, fontSize: 11 },
  requestBtn: { borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: 9, marginTop: 6 },
}));
