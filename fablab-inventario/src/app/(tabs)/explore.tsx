import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { listarSalas, resetCache, type Room } from '@/lib/inventory';

export default function InventoryScreen() {
  const [salas, setSalas] = useState<Room[]>([]);
  // listarSalas devuelve [] tanto si falló la red como si no hay salas; con 11
  // salas cargadas, un resultado vacío tras terminar la carga es un fallo.
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    listarSalas().then((lista) => {
      setSalas(lista);
      setCargando(false);
    });
  }, []);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Olvida la cache (memoria + AsyncStorage) y vuelve a pedir: el botón de
  // reintento que funciona igual en web y en nativo.
  async function refrescar() {
    if (refrescando) return;
    setRefrescando(true);
    try {
      await resetCache();
      cargar();
    } finally {
      setRefrescando(false);
    }
  }

  // /salas ya trae el conteo de elementos por sala (COUNT en SQL):
  // no hace falta descargar los 916 elementos para contarlos.
  const total = salas.reduce((sum, s) => sum + s.elementos, 0);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.content}>
          <View style={styles.titleRow}>
            <ThemedText type="title" style={styles.title}>Inventario</ThemedText>
            {salas.length > 0 && (
              <Pressable accessibilityRole="button" disabled={refrescando} onPress={refrescar} hitSlop={8}>
                <ThemedText style={styles.refreshLabel}>
                  {refrescando ? 'Actualizando…' : 'Actualizar'}
                </ThemedText>
              </Pressable>
            )}
          </View>
          <ThemedText themeColor="textSecondary" style={styles.intro}>
            {total === 0
              ? 'Sin elementos cargados todavía.'
              : `${total} elemento${total === 1 ? '' : 's'} en ${salas.length} salas.`}
          </ThemedText>

          <View style={styles.roomList}>
            {salas.map((sala) => {
              const count = sala.elementos;
              return (
                <ThemedView key={sala.id} type="backgroundElement" style={styles.roomCard}>
                  <View style={styles.roomAccent} />
                  <ThemedText type="subtitle" style={styles.roomTitle}>{sala.nombre}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {sala.edificio} · {count} elemento{count === 1 ? '' : 's'}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/sala/[nombre]', params: { nombre: String(sala.id) } })}
                    style={styles.viewButton}>
                    <ThemedText style={styles.viewButtonLabel}>Ver</ThemedText>
                  </Pressable>
                </ThemedView>
              );
            })}
            {!salas.length && cargando && (
              <ThemedText themeColor="textSecondary" style={styles.empty}>
                Cargando salas…
              </ThemedText>
            )}
            {!salas.length && !cargando && (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorText}>
                  No se pudieron cargar las salas. Revisa tu conexión.
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={refrescar} style={styles.retryButton}>
                  <ThemedText style={styles.viewButtonLabel}>Reintentar</ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        </SafeAreaView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, marginTop: Spacing.six },
  title: { color: '#C8102E' },
  refreshLabel: { color: '#C8102E', fontWeight: '700', fontSize: 14 },
  intro: { marginTop: Spacing.one, lineHeight: 21 },
  roomList: { gap: Spacing.three, marginTop: Spacing.five, width: '100%' },
  roomCard: { minHeight: 112, borderRadius: 12, padding: Spacing.four, paddingLeft: Spacing.four + Spacing.one, overflow: 'hidden', gap: Spacing.two },
  roomAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: '#C8102E' },
  roomTitle: { fontSize: 24, lineHeight: 32 },
  viewButton: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 8, backgroundColor: '#C8102E', paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.one },
  viewButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  empty: { marginTop: Spacing.four, lineHeight: 21 },
  errorBox: { marginTop: Spacing.four, gap: Spacing.three, alignItems: 'flex-start' },
  errorText: { color: '#C8102E', lineHeight: 21 },
  retryButton: { minHeight: 36, borderRadius: 8, backgroundColor: '#C8102E', paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
});
