// Fetch an authenticated file (e.g. branded PDF invoice/receipt) and open it.
// Web: opens a blob in a new tab. Native: writes to cache and shares.
import { Platform } from "react-native";
import { getTokens, APIError } from "@/src/api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export async function openAuthedFile(path: string, filename: string): Promise<void> {
  const tokens = await getTokens();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {},
  });
  if (!res.ok) throw new APIError(res.status, "Could not open the document");
  const blob = await res.blob();

  if (Platform.OS === "web") {
    const url = URL.createObjectURL(blob);
    if (typeof window !== "undefined" && window.open) window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }

  const FileSystem = await import("expo-file-system");
  const Sharing = await import("expo-sharing");
  const base64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
  }
}
