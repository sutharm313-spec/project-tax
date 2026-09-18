// Bottom tabs: Home · Services · Documents · Payments · Profile.
// iOS 26+ renders native Liquid Glass tabs; others use the classic styled bar.
import { Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Tabs } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";

import { usesNativeTabs } from "@/src/navigation";
import { useTheme } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();

  if (usesNativeTabs) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="house.fill" />
          <NativeTabs.Trigger.Label>{t("home")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="services">
          <NativeTabs.Trigger.Icon sf="briefcase.fill" />
          <NativeTabs.Trigger.Label>{t("services")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="documents">
          <NativeTabs.Trigger.Icon sf="folder.fill" />
          <NativeTabs.Trigger.Label>{t("documents")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="payments">
          <NativeTabs.Trigger.Icon sf="indianrupeesign.circle.fill" />
          <NativeTabs.Trigger.Label>{t("payments")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Icon sf="person.fill" />
          <NativeTabs.Trigger.Label>{t("profile")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "rgba(10,15,29,0.92)",
          borderTopColor: colors.divider,
          borderTopWidth: 1,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarActiveTintColor: "#3B82F6",
        tabBarInactiveTintColor: colors.muted,
        tabBarItemStyle: { alignSelf: "center" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t("home"), tabBarIcon: ({ color, size }) => <Icon name="home" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="services"
        options={{ title: t("services"), tabBarIcon: ({ color, size }) => <Icon name="briefcase" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="documents"
        options={{ title: t("documents"), tabBarIcon: ({ color, size }) => <Icon name="folder" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="payments"
        options={{ title: t("payments"), tabBarIcon: ({ color, size }) => <Icon name="card" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t("profile"), tabBarIcon: ({ color, size }) => <Icon name="person" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
