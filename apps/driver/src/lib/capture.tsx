import { useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Button, C, s } from "./ui";

/**
 * Full-screen camera that returns a compressed base64 data URL — the shape the engine's
 * `/deliver`, `/fail` and `/fuel` endpoints accept (≤ 2 MB, image/jpeg).
 */
export function CameraCapture(props: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onCaptured: (dataUrl: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  async function shoot() {
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({
        base64: true,
        quality: 0.5,
        imageType: "jpg",
        skipProcessing: true,
      });
      if (photo?.base64) props.onCaptured(`data:image/jpeg;base64,${photo.base64}`);
      props.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {!permission?.granted ? (
          <View style={[s.center, { backgroundColor: C.surface }]}>
            <Text style={s.h2}>Camera access</Text>
            <Text style={[s.body, { textAlign: "center", marginVertical: 12 }]}>
              We need the camera to capture proof of delivery and fuel receipts.
            </Text>
            <Button label="Allow camera" onPress={() => void requestPermission()} />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={props.onClose}
              style={{ marginTop: 10 }}
            />
          </View>
        ) : (
          <>
            <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
            <View style={{ padding: 20, gap: 10, backgroundColor: "#000" }}>
              <Text style={{ color: C.white, textAlign: "center" }}>{props.title}</Text>
              <Pressable
                onPress={shoot}
                disabled={busy}
                style={{
                  alignSelf: "center",
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: C.white,
                  opacity: busy ? 0.5 : 1,
                }}
              />
              <Button label="Cancel" variant="secondary" onPress={props.onClose} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
