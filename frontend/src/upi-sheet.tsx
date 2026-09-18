// Reusable UPI QR payment sheet: shows client-specific amount + admin UPI/QR,
// lets client submit the 12-digit UTR and optionally attach a payment screenshot.
// Status becomes "Under Verification" — only admin can mark it Received.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clipboard, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";

import { api, apiForm, apiUpload } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { pickFromGallery, pickFromFiles, type PickedFile } from "@/src/upload";
import { Button, Icon, Input, Sheet, useToast } from "@/src/ui";
import { makeStyles, radius, useTheme } from "@/src/theme";

type Initiate = { payment: { id: string }; upi_uri: string; vpa: string; payee_name: string; qr_base64: string; invoice: { number: string; total: number; service_name: string } };

export function UpiSheet({ invoiceId, visible, onClose, testID = "upi-sheet" }: { invoiceId: string | null; visible: boolean; onClose: () => void; testID?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useStyles();
  const { show } = useToast();
  const qc = useQueryClient();
  const [data, setData] = useState<Initiate | null>(null);
  const [utr, setUtr] = useState("");
  const [refErr, setRefErr] = useState<string | null>(null);
  const [shot, setShot] = useState<PickedFile | null>(null);
  const [uploading, setUploading] = useState(false);

  const initiate = useMutation({
    mutationFn: (id: string) => apiForm<Initiate>("/client/payments/initiate", { invoice_id: id }),
    onSuccess: (d) => {
      setData(d);
      setUtr("");
      setShot(null);
      setRefErr(null);
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not start payment", "error"),
  });

  const submitRef = useMutation({
    mutationFn: async (vars: { payment_id: string; utr: string }) => {
      await api(`/client/payments/${vars.payment_id}/submit`, { method: "POST", body: { utr: vars.utr } });
      if (shot) {
        setUploading(true);
        try {
          await apiUpload(`/client/payments/${vars.payment_id}/screenshot`, {}, shot);
        } catch {
          /* screenshot is optional — ignore failure */
        } finally {
          setUploading(false);
        }
      }
    },
    onSuccess: () => {
      setData(null);
      onClose();
      show("Reference submitted — status: Under Verification", "success");
      qc.invalidateQueries();
    },
    onError: (e) => setRefErr(e instanceof Error ? e.message : "Invalid reference"),
  });

  const pickShot = async () => {
    try {
      const f = (await pickFromGallery()) ?? (await pickFromFiles());
      if (f) setShot(f);
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not pick file", "error");
    }
  };

  const open = visible && !!invoiceId;
  if (open && !data && !initiate.isPending) initiate.mutate(invoiceId!);

  return (
    <Sheet visible={open} onClose={() => { setData(null); onClose(); }} title={t("upi_pay")}>
      {data ? (
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 600 }}>
          <View style={{ gap: 14, paddingBottom: 24 }}>
            <View style={s.qrWrap} testID={`${testID}-qr`}>
              <Image source={{ uri: data.qr_base64 }} style={{ width: 190, height: 190 }} />
            </View>
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 20 }}>₹{data.invoice.total.toLocaleString("en-IN")}</Text>
              <Text style={{ color: colors.muted, fontSize: 12.5 }}>{data.invoice.number} · {data.invoice.service_name}</Text>
              <Pressable
                onPress={async () => {
                  await Clipboard.setString(data.vpa);
                  show(t("copied"), "success");
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}
                testID={`${testID}-copy-vpa`}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "700" }}>{data.vpa}</Text>
                <Icon name="copy" size={14} color="#93C5FD" />
              </Pressable>
            </View>
            <Button
              label="Open UPI app"
              icon="open"
              variant="ghost"
              onPress={() => Linking.openURL(data.upi_uri).catch(() => show("Open on a phone with a UPI app, or scan the QR", "info"))}
              testID={`${testID}-open-app`}
            />
            <View style={{ height: 1, backgroundColor: colors.divider }} />
            <Input label={t("upi_ref")} value={utr} onChangeText={(v) => setUtr(v.replace(/\D/g, "").slice(0, 12))} keyboardType="number-pad" placeholder="123456789012" testID={`${testID}-utr-input`} />
            <Pressable onPress={pickShot} style={s.shotRow} testID={`${testID}-pick-screenshot`}>
              <Icon name={shot ? "checkmark-circle" : "image"} size={18} color={shot ? colors.success : colors.brand} />
              <Text style={{ color: colors.onSurface, flex: 1, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
                {shot ? shot.name : t("upload_screenshot")}
              </Text>
              {shot ? <Icon name="close-circle" size={18} color={colors.muted} onPress={() => setShot(null)} /> : null}
            </Pressable>
            {refErr ? <Text style={{ color: colors.error, fontSize: 12, textAlign: "center" }}>{refErr}</Text> : null}
            <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>{t("ref_hint")}</Text>
            <Button
              label={t("submit_ref")}
              icon="checkmark-circle"
              loading={submitRef.isPending || uploading}
              onPress={() => {
                if (utr.length !== 12) return setRefErr("UPI reference must be exactly 12 digits");
                setRefErr(null);
                submitRef.mutate({ payment_id: data.payment.id, utr });
              }}
              testID={`${testID}-submit-utr`}
            />
          </View>
        </ScrollView>
      ) : (
        <View style={{ alignItems: "center", padding: 30 }}>
          <Text style={{ color: colors.muted }}>{t("loading")}</Text>
        </View>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  qrWrap: { alignSelf: "center", padding: 14, backgroundColor: "#FFFFFF", borderRadius: radius.lg },
  shotRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12 },
}));
