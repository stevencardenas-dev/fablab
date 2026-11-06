// Lector de Data Matrix con la cámara (expo-camera). Devuelve el texto leído,
// que la app busca como `codigo` exacto.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDisposicion } from '@/hooks/use-disposicion';
import { useTheme } from '@/hooks/use-theme';

export function Scanner({ onScanned }: { onScanned: (data: string) => void }) {
  const theme = useTheme();
  const { escritorio } = useDisposicion();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={[styles.permissionBox, escritorio && styles.permissionBoxEscritorio, { borderColor: `${theme.accent}44`, backgroundColor: `${theme.accent}0F` }]}>
        <View style={styles.permissionIcono}><CameraIcon /></View>
        <View style={styles.permissionTexto}>
          <ThemedText type="smallBold">Permiso de cámara</ThemedText>
          <ThemedText themeColor="textSecondary" type="small" style={styles.permissionText}>
            Se necesita para leer la etiqueta Data Matrix del elemento.
          </ThemedText>
        </View>
        <Pressable accessibilityRole="button" onPress={requestPermission} style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}>
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

function CameraIcon() {
  return (
    <Svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <Path d="M4 9a2 2 0 0 1 2-2h1.4l.9-1.5A1 1 0 0 1 9.2 5h5.6a1 1 0 0 1 .9.5L16.6 7H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" />
      <Circle cx="12" cy="12.5" r="3" stroke="#FFFFFF" strokeWidth="1.8" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  cameraBox: { width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  // Aviso de permiso: caja con el acento del tema, icono, explicación y botón.
  permissionBox: { gap: Spacing.two, alignItems: 'flex-start', borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  permissionBoxEscritorio: { flexDirection: 'row', alignItems: 'center' },
  permissionIcono: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center' },
  permissionTexto: { flex: 1, minWidth: 0, gap: Spacing.half },
  permissionText: { lineHeight: 19 },
  permissionButton: { minHeight: 40, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  permissionButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  rescanButton: { position: 'absolute', bottom: Spacing.two, alignSelf: 'center', minHeight: 40, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  rescanLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  pressed: { opacity: 0.78 },
});
