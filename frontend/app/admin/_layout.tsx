// Admin/Staff portal layout: desktop sidebar + responsive guards.
import { useState } from "react";
import { Slot, usePathname, useRouter } from "expo-router";
import { Dimensions, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import Animated, { FadeIn } from "react-native-reanimated";

import { useAuth } from "@/src/auth";
import { BrandMark, Button, Icon } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const NAV = [
  { route: "/admin", label: "Dashboard", icon: "stats-chart" },
  { route: "/admin/requests", label: "Services", icon: "layers" },
  { route: "/admin/payments", label: "Payments", icon: "card" },
  { route: "/admin/documents", label: "Documents", icon: "folder" },
  { route: "/admin/clients", label: "Clients", icon: "people" },
  { route: "/admin/leads", label: "CRM Leads", icon: "trending-up" },
  { route: "/admin/tickets", label: "Tickets", icon: "headset" },
  { route: "/admin/catalog", label: "Catalog", icon: "pricetags" },
  { route: "/admin/pricing", label: "Bulk Pricing", icon: "cash" },
  { route: "/admin/recurring", label: "Recurring", icon: "repeat" },
  { route: "/admin/deadlines", label: "Deadlines", icon: "alarm" },
  { route: "/admin/staff", label: "Staff", icon: "shield" },
  { route: "/admin/settings", label: "Settings", icon: "settings" },
];

export default function AdminLayout() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isStaff, loading } = useAuth();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const isDesktop = Dimensions.get("window").width >= 1024;
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return (
      <View style={[s.root, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: colors.muted }}>Loading admin…</Text>
      </View>
    );
  }
  if (!user || !isStaff) {
    return (
      <View style={[s.root, { alignItems: "center", justifyContent: "center", gap: 14, padding: 32 }]}>
        <BrandMark size={22} showTagline />
        <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center" }}>Staff sign-in required</Text>
        <Text style={{ color: colors.muted, textAlign: "center", maxWidth: 320 }}>
          This dashboard is for taxman.manoj staff. Sign in with an admin or staff account to continue.
        </Text>
        <Button label="Go to sign in" onPress={() => router.replace("/(auth)/login")} testID="admin-go-login" />
      </View>
    );
  }

  const navItems = (
    <View style={{ gap: 2 }}>
      {NAV.map((n) => {
        const active = pathname === n.route;
        return (
          <Pressable key={n.route} onPress={() => { router.push(n.route); setMenuOpen(false); }} style={[s.navItem, active && { backgroundColor: "rgba(37,99,235,0.18)" }]} testID={`admin-nav-${n.label.toLowerCase().replace(" ", "-")}`}>
            <Icon name={n.icon} size={17} color={active ? "#60A5FA" : colors.onSurfaceSecondary} />
            <Text style={[s.navText, active && { color: "#60A5FA", fontWeight: "800" }]}>{n.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={{ flexDirection: "row", flex: 1 }}>
        {isDesktop ? (
          <View style={s.sidebar}>
            <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 14 }}>
              <BrandMark size={20} showTagline />
            </View>
            {navItems}
            <View style={{ marginTop: "auto", padding: 16, gap: 8 }}>
              <Text style={{ color: colors.muted, fontSize: 11 }}>{user.name} · {user.role.replace(/_/g, " ")}</Text>
              <Button label="Client app" icon="phone-portrait" variant="ghost" onPress={() => router.replace("/(tabs)")} testID="admin-back-client" />
            </View>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          {!isDesktop ? (
            <BlurView intensity={40} tint="dark" style={s.mobileBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, alignItems: "center" }}>
                {NAV.map((n) => {
                  const active = pathname === n.route;
                  return (
                    <Pressable key={n.route} onPress={() => router.push(n.route)} style={[s.mobItem, active && { backgroundColor: "rgba(37,99,235,0.25)" }]} testID={`admin-nav-mobile-${n.label.toLowerCase().replace(" ", "-")}`}>
                      <Icon name={n.icon} size={14} color={active ? "#60A5FA" : colors.onSurfaceSecondary} />
                      <Text style={[s.mobText, active && { color: "#60A5FA" }]}>{n.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </BlurView>
          ) : null}
          <Animated.View entering={FadeIn.duration(220)} style={{ flex: 1 }}>
            {/* Slot renders the active admin route */}
            <Slot />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  sidebar: { width: 240, borderRightWidth: 1, borderRightColor: colors.divider, backgroundColor: colors.surfaceSecondary },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 11, marginHorizontal: 8, borderRadius: radius.md, minHeight: 42 },
  navText: { color: colors.onSurfaceTertiary, fontWeight: "600", fontSize: 13.5 },
  mobileBar: { paddingTop: 10, paddingBottom: 8, backgroundColor: "rgba(10,15,29,0.9)", borderBottomWidth: 1, borderBottomColor: colors.divider },
  mobItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.divider, flexShrink: 0 },
  mobText: { color: colors.onSurfaceTertiary, fontWeight: "700", fontSize: 12 },
}));
