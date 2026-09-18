// Animated splash: premium logo reveal → routes based on session + onboarding flag.
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { View, Text } from "react-native";
import Animated, { Easing, FadeIn, interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/ionicons";

import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";

export default function Splash() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const navigated = useRef(false);
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
  }, [p]);

  useEffect(() => {
    if (loading || navigated.current) return;
    navigated.current = true;
    const t = setTimeout(() => {
      (async () => {
        const seen = await storage.getItem("tm_onboarded", false);
        if (user) router.replace(user.role === "client" ? "/(tabs)" : "/admin");
        else if (seen) router.replace("/(auth)/login");
        else router.replace("/onboarding");
      })();
    }, 1700);
    return () => clearTimeout(t);
  }, [loading, user, router]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.35, 1], [0, 1, 1]),
    transform: [{ scale: interpolate(p.value, [0, 0.6, 1], [0.6, 1.06, 1]) }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.3, 0.7], [0, 1]),
    transform: [{ translateY: interpolate(p.value, [0.3, 1], [14, 0]) }],
  }));
  const barStyle = useAnimatedStyle(() => ({ width: `${interpolate(p.value, [0, 1], [0, 100])}%` }));

  return (
    <LinearGradient colors={["#0A0F1D", "#0F1B3D", "#0A0F1D"]} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Animated.View entering={FadeIn.duration(600)} style={{ alignItems: "center" }}>
        <Animated.View style={[{ alignItems: "center" }, logoStyle]}>
          <View style={{ width: 96, height: 96, borderRadius: 28, backgroundColor: "rgba(37,99,235,0.15)", borderWidth: 1, borderColor: "rgba(59,130,246,0.4)", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
            <Icon name="shield-checkmark" size={48} color="#3B82F6" />
          </View>
          <Animated.Text style={{ color: "#F8FAFC", fontSize: 34, fontWeight: "800", letterSpacing: -0.5 }}>
            taxman.manoj
          </Animated.Text>
          <Animated.Text style={{ color: "#64748B", fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginTop: 8 }}>
            Your Compliance. Simplified.
          </Animated.Text>
        </Animated.View>
        <View style={{ height: 3, width: 160, borderRadius: 2, backgroundColor: "#1E293B", marginTop: 48, overflow: "hidden" }}>
          <Animated.View style={[{ height: 3, borderRadius: 2, backgroundColor: "#2563EB" }, barStyle]} />
        </View>
      </Animated.View>
      <View style={{ position: "absolute", bottom: 60 }} pointerEvents="none">
        <Text style={{ color: "#334155", fontSize: 11, letterSpacing: 1 }}>SECURE · PRIVATE · PROFESSIONAL</Text>
      </View>
    </LinearGradient>
  );
}
