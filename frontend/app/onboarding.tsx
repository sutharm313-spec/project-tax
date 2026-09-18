// Onboarding: 4 premium slides with progress dots, skip, get started.
import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Dimensions, FlatList, Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { storage } from "@/src/utils/storage";
import { Button, Icon } from "@/src/ui";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    icon: "document-text",
    title: "Manage Your Compliance",
    body: "Every ITR, GST return, TDS filing and audit — organized by business and financial year in one premium workspace.",
    img: "https://images.unsplash.com/photo-1586486855514-8c633cc6fd38?auto=format&fit=crop&q=80&w=900",
  },
  {
    icon: "cloud-upload",
    title: "Upload Documents Securely",
    body: "Bank-grade private storage. Upload from camera, gallery or files — always free, even before payment.",
    img: "https://images.unsplash.com/photo-16863202/pexels-photo-6863202.jpeg?auto=format&fit=crop&q=80&w=900",
  },
  {
    icon: "git-branch",
    title: "Track Your Work",
    body: "Live timeline from request to completion. Know exactly where your filing stands, every step of the way.",
    img: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=900",
  },
  {
    icon: "notifications",
    title: "Stay Ahead of Deadlines",
    body: "Smart reminders for filings, payments and document expiry — so you never miss a compliance date again.",
    img: "https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?auto=format&fit=crop&q=80&w=900",
  },
];

export default function Onboarding() {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const listRef = useRef<FlatList>(null);
  const scrollX = useSharedValue(0);

  const finish = async () => {
    await storage.setItem("tm_onboarded", true);
    router.replace("/(auth)/login");
  };

  const goNext = () => {
    if (idx >= SLIDES.length - 1) finish();
    else listRef.current?.scrollToIndex({ index: idx + 1, animated: true });
  };

  return (
    <LinearGradient colors={["#0A0F1D", "#0D1730", "#0A0F1D"]} style={{ flex: 1 }}>
      <View style={{ paddingTop: 64, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: "#F8FAFC", fontWeight: "800", fontSize: 17 }}>
          taxman.manoj
        </Text>
        <Pressable onPress={finish} hitSlop={12} testID="onboarding-skip">
          <Text style={{ color: "#64748B", fontWeight: "600" }}>Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onScroll={(e) => (scrollX.value = e.nativeEvent.contentOffset.x / width)}
        onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index }) => {
          const isLast = index === SLIDES.length - 1;
          return (
            <View style={{ width, paddingHorizontal: 24, paddingTop: 36, gap: 28 }}>
              <Animated.View entering={FadeInDown.springify().damping(16)} style={{ borderRadius: 28, overflow: "hidden", borderWidth: 1, borderColor: "rgba(59,130,246,0.25)" }}>
                <View style={{ height: 380, backgroundColor: "#0D1730" }}>
                  <Animated.Image
                    source={{ uri: item.img }}
                    style={{ width: "100%", height: "100%", opacity: 0.5 }}
                    resizeMode="cover"
                  />
                  <BlurView intensity={18} tint="dark" style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: "55%" }} />
                  <View style={{ position: "absolute", bottom: 24, left: 24, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(37,99,235,0.3)", borderWidth: 1, borderColor: "rgba(59,130,246,0.5)", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={item.icon} size={26} color="#93C5FD" />
                    </View>
                    <Text style={{ color: "#F8FAFC", fontSize: 22, fontWeight: "800", flexShrink: 1, flexWrap: "wrap", maxWidth: width - 160 }}>
                      {item.title}
                    </Text>
                  </View>
                </View>
              </Animated.View>
              <Text style={{ color: "#94A3B8", fontSize: 15.5, lineHeight: 24 }}>{item.body}</Text>
              {isLast ? (
                <View style={{ marginTop: "auto" }} />
              ) : null}
            </View>
          );
        }}
      />

      <View style={{ paddingHorizontal: 24, paddingBottom: 44, gap: 22 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {SLIDES.map((_, i) => (
            <View key={i} style={{ height: 6, borderRadius: 3, backgroundColor: i === idx ? "#2563EB" : "#1E293B", width: i === idx ? 26 : 6 }} />
          ))}
        </View>
        <Button label={idx === SLIDES.length - 1 ? "Get Started" : "Next"} onPress={goNext} testID="onboarding-next" />
      </View>
    </LinearGradient>
  );
}
