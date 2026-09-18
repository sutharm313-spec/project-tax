// Client-side selection context: active business + financial year (persisted).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type Business = { id: string; name: string; type: string; gstin?: string; pan?: string };
export type SessionUser = { id: string; name: string; client_code?: string; email?: string; mobile?: string };

type AppCtx = {
  businessId: string | null;
  setBusinessId: (id: string) => void;
  fy: string;
  setFy: (fy: string) => void;
  fyList: string[];
  businesses: Business[];
  reloadBusinesses: () => Promise<void>;
};

const Ctx = createContext<AppCtx>(null as never);
export const FY_LIST = ["FY 2024-25", "FY 2025-26", "FY 2026-27", "FY 2027-28"];

export function ClientAppProvider({ children }: { children: React.ReactNode }) {
  const [businessId, setBusinessIdState] = useState<string | null>(null);
  const [fy, setFyState] = useState<string>("FY 2026-27");
  const [businesses, setBusinesses] = useState<Business[]>([]);

  const reloadBusinesses = useCallback(async () => {
    try {
      const res = await api<{ businesses: Business[] }>("/client/businesses");
      setBusinesses(res.businesses);
      setBusinessIdState((prev) => prev && res.businesses.some((b) => b.id === prev) ? prev : (res.businesses[0]?.id ?? null));
    } catch {
      setBusinesses([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem("tm_fy", "FY 2026-27");
      setFyState(saved);
      await reloadBusinesses();
      const savedBiz = await storage.getItem("tm_business", "");
      if (savedBiz) setBusinessIdState(savedBiz);
    })();
  }, [reloadBusinesses]);

  const setBusinessId = useCallback((id: string) => {
    setBusinessIdState(id);
    storage.setItem("tm_business", id);
  }, []);
  const setFy = useCallback((f: string) => {
    setFyState(f);
    storage.setItem("tm_fy", f);
  }, []);

  const value = useMemo(
    () => ({ businessId, setBusinessId, fy, setFy, fyList: FY_LIST, businesses, reloadBusinesses }),
    [businessId, setBusinessId, fy, setFy, businesses, reloadBusinesses],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientApp() {
  return useContext(Ctx);
}
