import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export function Scanner({ onScanned }: { onScanned: (data: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={styles.permissionBox}>
        <ThemedText themeColor="textSecondary" style={styles.permissionText}>
          Se necesita permiso de cámara para escanear.
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={requestPermission} style={styles.permissionButton}>
          <ThemedText style={styles.permissionButtonLabel}>Permitir cámara</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.cameraBox}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['datamatrix'] }}
        onBarcodeScanned={
          scanned
            ? undefined
            : ({ data }) => {
                setScanned(true);
                onScanned(data);
              }
        }
      />
      {scanned && (
        <Pressable accessibilityRole="button" onPress={() => setScanned(false)} style={styles.rescanButton}>
          <ThemedText style={styles.rescanLabel}>Escanear otro</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cameraBox: { width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  permissionBox: { gap: Spacing.two, alignItems: 'flex-start' },
  permissionText: { lineHeight: 21 },
  permissionButton: { minHeight: 44, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  permissionButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  rescanButton: { position: 'absolute', bottom: Spacing.two, alignSelf: 'center', minHeight: 40, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  rescanLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
