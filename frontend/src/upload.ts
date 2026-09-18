// File picking (camera / gallery / files) + upload helpers with permission flow.
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Linking, Platform } from "react-native";

export type PickedFile = { uri: string; name: string; mimeType: string; size?: number };

function openSettingsHint() {
  Linking.openSettings();
}

export async function pickFromCamera(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    if (perm.canAskAgain === false) openSettingsHint();
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mimeType: a.mimeType ?? "image/jpeg", size: a.fileSize };
}

export async function pickFromGallery(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    if (perm.canAskAgain === false) openSettingsHint();
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.fileName ?? `image-${Date.now()}.jpg`, mimeType: a.mimeType ?? "image/jpeg", size: a.fileSize };
}

const DOC_TYPES = ["pdf", "jpg", "jpeg", "png", "xls", "xlsx", "doc", "docx", "zip"];

export async function pickFromFiles(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/jpeg", "image/png",
           "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
           "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
           "application/zip", "application/x-zip-compressed", "application/octet-stream"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const ext = (a.name.split(".").pop() ?? "").toLowerCase();
  if (!DOC_TYPES.includes(ext)) throw new Error(`.${ext} files are not allowed`);
  return { uri: a.uri, name: a.name, mimeType: a.mimeType ?? "application/octet-stream", size: a.size };
}
