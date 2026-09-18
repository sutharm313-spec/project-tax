// Design tokens — deep navy fintech palette from /app/design_guidelines.json.
// Single premium dark scheme; keys match the "color" block of the guidelines.
import { useMemo } from "react";
import { StyleSheet } from "react-native";

export type ColorScheme = "light" | "dark";

const navy = {
  surface: "#0A0F1D",
  onSurface: "#F8FAFC",
  surfaceSecondary: "#111827",
  onSurfaceSecondary: "#94A3B8",
  surfaceTertiary: "#1E293B",
  onSurfaceTertiary: "#CBD5E1",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0F172A",
  brand: "#3B82F6",
  onBrand: "#FFFFFF",
  brandPrimary: "#2563EB",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#1D4ED8",
  onBrandSecondary: "#E0E7FF",
  brandTertiary: "#1E3A8A",
  onBrandTertiary: "#93C5FD",
  success: "#10B981",
  onSuccess: "#ECFDF5",
  warning: "#F59E0B",
  onWarning: "#FEF3C7",
  error: "#EF4444",
  onError: "#FEF2F2",
  info: "#3B82F6",
  onInfo: "#EFF6FF",
  border: "#334155",
  borderStrong: "#475569",
  divider: "#1E293B",
  muted: "#64748B",
};

export type ThemeColors = typeof navy;

export const defaultScheme: ColorScheme = "dark";

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light: navy };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

export function setColorScheme(_scheme: ColorScheme | null) {
  // Single premium scheme; kept for API compatibility.
}

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  return { scheme: defaultScheme, colors: navy };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
