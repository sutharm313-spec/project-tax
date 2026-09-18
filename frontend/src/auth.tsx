// Auth context: session hydration, register/login/OTP, logout, language sync.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearTokens, getTokens, saveTokens, type Tokens } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type SessionUser = {
  id: string;
  role: string;
  name: string;
  email: string;
  mobile: string;
  client_code?: string | null;
  status?: string;
  language?: string;
  permissions?: string[];
  pan?: string;
  address?: string;
  profile?: Record<string, unknown>;
  notification_prefs?: Record<string, boolean>;
};

type AuthCtx = {
  user: SessionUser | null;
  loading: boolean;
  isStaff: boolean;
  login: (identifier: string, password: string) => Promise<{ requiresOtp?: boolean; email?: string }>;
  register: (name: string, email: string, mobile: string, password: string) => Promise<{ dev_otp?: string }>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  resendOtp: (email: string) => Promise<{ dev_otp?: string }>;
  forgot: (email: string) => Promise<{ dev_otp?: string }>;
  reset: (email: string, code: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const res = await api<{ user: SessionUser }>("/auth/me");
    setUser(res.user);
    if (res.user?.language) storage.setItem("tm_lang", res.user.language);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const tokens = await getTokens();
        if (tokens?.access_token) {
          try {
            await refreshUser();
          } catch {
            await clearTokens();
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshUser]);

  const applySession = useCallback(async (data: Tokens & { user?: SessionUser }) => {
    await saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (data.user) {
      setUser(data.user);
      if (data.user.language) storage.setItem("tm_lang", data.user.language);
    }
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api<Tokens & { user?: SessionUser; requires_otp?: boolean; dev_otp?: string; email?: string }>(
        "/auth/login",
        { method: "POST", body: { identifier, password } },
      );
      if ("requires_otp" in res && res.requires_otp) return { requiresOtp: true, email: res.email };
      if (res.access_token) await applySession(res);
      return {};
    },
    [applySession],
  );

  const register = useCallback(async (name: string, email: string, mobile: string, password: string) => {
    return api<{ dev_otp?: string }>("/auth/register", { method: "POST", body: { name, email, mobile, password } });
  }, []);

  const verifyOtp = useCallback(
    async (email: string, code: string) => {
      const res = await api<Tokens & { user: SessionUser }>("/auth/verify-otp", { method: "POST", body: { email, code } });
      await applySession(res);
    },
    [applySession],
  );

  const resendOtp = useCallback((email: string) => api<{ dev_otp?: string }>("/auth/resend-otp", { method: "POST", body: { email } }), []);

  const forgot = useCallback((email: string) => api<{ dev_otp?: string }>("/auth/forgot-password", { method: "POST", body: { email } }), []);

  const reset = useCallback(async (email: string, code: string, password: string) => {
    await api("/auth/reset-password", { method: "POST", body: { email, code, new_password: password } });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors on logout
    }
    setUser(null);
    await clearTokens();
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      isStaff: !!user && ["super_admin", "admin", "manager", "accountant", "tax_staff", "gst_staff", "support_staff"].includes(user.role),
      login,
      register,
      verifyOtp,
      resendOtp,
      forgot,
      reset,
      logout,
      refreshUser,
    }),
    [user, loading, login, register, verifyOtp, resendOtp, forgot, reset, logout, refreshUser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
