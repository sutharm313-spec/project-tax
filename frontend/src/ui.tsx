// Shared premium UI kit: buttons, cards, inputs, badges, sheets, toasts,
// skeletons, chips, animated counters, timeline. All themed via tokens.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View, ViewStyle, TextStyle, DimensionValue } from "react-native";
import Animated, { FadeIn, FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/ionicons";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export { Icon };

// ---------- toasts ----------
type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; text: string; kind: ToastKind };
const ToastCtx = createContext<{ show: (text: string, kind?: ToastKind) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((text: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", top: 60, left: 0, right: 0, alignItems: "center", zIndex: 9999 }}>
        {toasts.map((t) => (
          <Animated.View key={t.id} entering={FadeInDown.springify().damping(15)} style={toastStyles.toast}>
            <BlurView intensity={40} tint="dark" style={toastStyles.blur}>
              <View style={toastStyles.row}>
                <Icon
                  name={t.kind === "success" ? "checkmark-circle" : t.kind === "error" ? "alert-circle" : "information-circle"}
                  size={20}
                  color={t.kind === "success" ? "#10B981" : t.kind === "error" ? "#EF4444" : "#3B82F6"}
                />
                <Text style={toastStyles.text}>{t.text}</Text>
              </View>
            </BlurView>
          </Animated.View>
        ))}
      </View>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

const toastStyles = {
  toast: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, overflow: "hidden" as const, borderWidth: 1, borderColor: "rgba(59,130,246,0.35)" },
  blur: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "rgba(17,24,39,0.85)" },
  row: { flexDirection: "row" as const, alignItems: "center", gap: 10 },
  text: { color: "#F8FAFC", fontSize: 13.5, flexShrink: 1, fontWeight: "500" as const },
};

// ---------- button ----------
export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "ghost" | "danger" | "soft";
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  style?: ViewStyle;
  testID?: string;
}) {
  const { colors } = useTheme();
  const s = useBtnStyles();
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[aStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        disabled={disabled || loading}
        onPressIn={() => (scale.value = withTiming(0.97, { duration: 80 }))}
        onPressOut={() => (scale.value = withTiming(1, { duration: 120 }))}
        onPress={onPress}
        style={({ pressed }) => [s.btn, s[variant], pressed && { opacity: 0.9 }, (disabled || loading) && { opacity: 0.55 }]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={variant === "primary" ? colors.onBrandPrimary : colors.brand} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={18} color={variant === "primary" ? colors.onBrandPrimary : colors.brand} /> : null}
            <Text style={[s.btnText, { color: variant === "primary" ? colors.onBrandPrimary : colors.brandPrimary }]}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const useBtnStyles = makeStyles((colors) => ({
  btn: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primary: { backgroundColor: colors.brandPrimary },
  ghost: { backgroundColor: "transparent", borderWidth: 1.2, borderColor: colors.borderStrong },
  soft: { backgroundColor: colors.brandTertiary },
  danger: { backgroundColor: colors.error },
  btnText: { fontSize: 15, fontWeight: "700" },
}));

// ---------- card ----------
export function Card({ children, style, testID, glass }: { children: React.ReactNode; style?: ViewStyle; testID?: string; glass?: boolean }) {
  const { colors } = useTheme();
  const s = useStyles();
  if (glass) {
    return (
      <View style={[s.card, { overflow: "hidden" }, style]}>
        <BlurView intensity={30} tint="dark" style={s.glass}>
          {children}
        </BlurView>
      </View>
    );
  }
  return (
    <View testID={testID} style={[s.card, style]}>
      {children}
    </View>
  );
}

// ---------- input ----------
export function Input({
  label,
  error,
  secure,
  testID,
  ...rest
}: {
  label?: string;
  error?: string | null;
  secure?: boolean;
  testID?: string;
} & React.ComponentProps<typeof TextInput>) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={s.inputLabel}>{label}</Text> : null}
      <View style={[s.inputWrap, !!error && { borderColor: colors.error, borderWidth: 1.4 }]}>
        <TextInput
          testID={testID}
          secureTextEntry={secure}
          placeholderTextColor={colors.muted}
          style={s.input}
          autoCapitalize="none"
          {...rest}
        />
      </View>
      {!!error && (
        <Text style={[s.errorText]} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      )}
    </View>
  );
}

// ---------- status badge ----------
export const STATUS_COLORS: Record<string, string> = {
  uploaded: "#3B82F6", under_review: "#F59E0B", approved: "#10B981", rejected: "#EF4444",
  reupload_required: "#F59E0B", required: "#64748B", not_required: "#64748B",
  verified: "#10B981", pending: "#F59E0B", submitted: "#3B82F6", paid: "#10B981",
  unpaid: "#F59E0B", cancelled: "#64748B", refunded: "#8B5CF6", partially_paid: "#F59E0B",
  open: "#3B82F6", in_progress: "#3B82F6", waiting_for_client: "#F59E0B", resolved: "#10B981",
  closed: "#64748B", completed: "#10B981", payment_pending: "#F59E0B", payment_submitted: "#3B82F6",
  active: "#10B981", new: "#3B82F6", contacted: "#8B5CF6", follow_up: "#F59E0B",
  proposal_sent: "#06B6D4", converted: "#10B981", lost: "#EF4444", waiting_info: "#F59E0B",
};

export function StatusBadge({ status, label, testID }: { status: string; label?: string; testID?: string }) {
  const s = useStyles();
  const color = STATUS_COLORS[status] ?? "#64748B";
  return (
    <View testID={testID} style={[s.badge, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
      <View style={[s.badgeDot, { backgroundColor: color }]} />
      <Text style={{ color, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>
        {label ?? status.replace(/_/g, " ")}
      </Text>
    </View>
  );
}

// ---------- skeleton ----------
export function Skeleton({ width, height = 16, style, circle }: { width?: DimensionValue; height?: number; style?: ViewStyle; circle?: boolean }) {
  const { colors } = useTheme();
  const progress = useSharedValue(0.35);
  useEffect(() => {
    progress.value = withRepeat(withTiming(0.85, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [progress]);
  const a = useAnimatedStyle(() => ({ opacity: progress.value }));
  return (
    <Animated.View
      style={[{ width: width ?? "100%", height, backgroundColor: colors.surfaceTertiary, borderRadius: circle ? 999 : radius.sm, alignSelf: circle ? "center" : undefined }, a, style]}
    />
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  const s = useStyles();
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} style={{ gap: 10 }}>
          <Skeleton width="55%" height={14} />
          <Skeleton width="85%" height={12} />
          <Skeleton width="35%" height={12} />
        </Card>
      ))}
    </View>
  );
}

// ---------- empty state ----------
export function EmptyState({ icon, title, body, actionLabel, onAction, testID }: { icon: string; title: string; body?: string; actionLabel?: string; onAction?: () => void; testID?: string }) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <Animated.View entering={FadeIn.springify()} style={s.empty} testID={testID}>
      <View style={s.emptyIconWrap}>
        <Icon name={icon} size={30} color={colors.brandTertiary ? "#93C5FD" : colors.brand} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      {body ? <Text style={s.emptyBody}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ marginTop: 16, minWidth: 170 }} testID={`${testID}-action`} />
      ) : null}
    </Animated.View>
  );
}

// ---------- error state ----------
export function ErrorState({ message, onRetry, testID }: { message: string; onRetry?: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Something went wrong"
      body={message}
      actionLabel={onRetry ? "Retry" : undefined}
      onAction={onRetry}
      testID={testID ?? "error-state"}
    />
  );
}

// ---------- sheet (modal bottom sheet) ----------
export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID={testID}>
      <Pressable style={[s.sheetOverlay, { backgroundColor: "rgba(2,6,23,0.6)" }]} onPress={onClose} />
      <View style={s.sheetWrap} pointerEvents="box-none">
        <Animated.View entering={FadeInDown.springify().damping(18)} style={s.sheet}>
          <View style={s.sheetGrab} />
          {title ? <Text style={s.sheetTitle}>{title}</Text> : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ---------- chips (filter row) ----------
export function ChipRow({ items, value, onChange, testPrefix = "chip" }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void; testPrefix?: string }) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <View style={s.chipRow}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <Pressable
            key={it.key}
            testID={`${testPrefix}-${it.key}`}
            onPress={() => onChange(it.key)}
            style={[s.chip, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }, { flexShrink: 0 }]}
          >
            <Text style={[s.chipText, active && { color: colors.onBrandPrimary }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- animated counter ----------
export function AnimatedCounter({ value, prefix = "", testID }: { value: number; prefix?: string; testID?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef({ v: 0 });
  useEffect(() => {
    const from = ref.current.v;
    const start = Date.now();
    const dur = 700;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      ref.current.v = Math.round(from + (value - from) * eased);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return (
    <Text testID={testID}>
      {prefix}
      {display.toLocaleString("en-IN")}
    </Text>
  );
}

// ---------- section header ----------
export function SectionHeader({ title, actionLabel, onAction, testID }: { title: string; actionLabel?: string; onAction?: () => void; testID?: string }) {
  const s = useStyles();
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionTitle} testID={testID}>
        {title}
      </Text>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={s.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- metric tile ----------
export function Metric({ icon, label, value, color, prefix, testID, onPress }: { icon: string; label: string; value: number | string; color?: string; prefix?: string; testID?: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={s.metric} testID={testID}>
      <View style={[s.metricIcon, { backgroundColor: `${color ?? colors.brand}22` }]}>
        <Icon name={icon} size={16} color={color ?? colors.brand} />
      </View>
      <Text style={s.metricValue}>{typeof value === "number" ? <AnimatedCounter value={value} prefix={prefix} testID={testID ? `${testID}-value` : undefined} /> : value}</Text>
      <Text style={s.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------- progress bar ----------
export function ProgressBar({ pct, color, height = 6 }: { pct: number; color?: string; height?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ height, borderRadius: 999, backgroundColor: colors.surfaceTertiary, overflow: "hidden" }}>
      <Animated.View entering={FadeIn} style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height, borderRadius: 999, backgroundColor: color ?? colors.brandPrimary }} />
    </View>
  );
}

// ---------- layout helpers ----------
export function Screen({ children, style, testID }: { children: React.ReactNode; style?: ViewStyle; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[{ flex: 1, backgroundColor: colors.surface }, style]}>
      {children}
    </View>
  );
}

export function BrandMark({ size = 28, showTagline = false }: { size?: number; showTagline?: boolean }) {
  const s = useStyles();
  return (
    <View style={{ alignItems: "flex-start", gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LinearGradient colors={["#2563EB", "#1E3A8A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.3, alignItems: "center", justifyContent: "center" }}>
          <Icon name="shield-checkmark" size={size * 0.55} color="#FFFFFF" />
        </LinearGradient>
        <Text style={{ color: "#F8FAFC", fontSize: size * 0.72, fontWeight: "800", letterSpacing: -0.3 }}>
          taxman.manoj
        </Text>
      </View>
      {showTagline ? <Text style={{ color: "#64748B", fontSize: size * 0.36, letterSpacing: 1.2, textTransform: "uppercase" }}>Your Compliance. Simplified.</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.lg,
  },
  glass: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, backgroundColor: "rgba(17,24,39,0.55)" },
  inputLabel: { color: colors.onSurfaceTertiary, fontSize: 12.5, fontWeight: "600" },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  input: { flex: 1, color: colors.onSurface, fontSize: 15, paddingVertical: 12 },
  errorText: { color: colors.error, fontSize: 12 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  empty: { alignItems: "center", padding: spacing.xxl, gap: 8 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  emptyTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "700" },
  emptyBody: { color: colors.muted, fontSize: 13.5, textAlign: "center", maxWidth: 280, lineHeight: 20 },
  sheetOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xl, gap: 12 },
  sheetGrab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 4 },
  sheetTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  chipRow: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.lg, height: 56, alignItems: "center" },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, justifyContent: "center", marginVertical: 10 },
  chipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600" },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: 10 },
  sectionTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  sectionAction: { color: colors.brand, fontSize: 13, fontWeight: "600" },
  metric: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, padding: spacing.md, gap: 6, minWidth: 100 },
  metricIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  metricValue: { color: colors.onSurface, fontSize: 19, fontWeight: "800" },
  metricLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
}));
