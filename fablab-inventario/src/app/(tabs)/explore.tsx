import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getAllItems, listarSalas, SinUbicacion, type InventoryItem, type Room } from '@/lib/inventory';

export default function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [salas, setSalas] = useState<Room[]>([]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([getAllItems().then(setItems), listarSalas().then(setSalas)]);
    }, []),
  );

  const total = items.length;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.content}>
          <ThemedText type="title" style={styles.title}>Inventario</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.intro}>
            {total === 0
              ? 'Sin elementos cargados todavía.'
              : `${total} elemento${total === 1 ? '' : 's'} en ${salas.length} salas.`}
          </ThemedText>

          <View style={styles.roomList}>
            {salas.map((sala) => {
              const count = items.filter((i) => i.sala_id === sala.id).length;
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
            {!salas.length && (
              <ThemedText themeColor="textSecondary" style={styles.empty}>
                Cargando salas…
              </ThemedText>
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
  title: { color: '#C8102E', marginTop: Spacing.six },
  intro: { marginTop: Spacing.one, lineHeight: 21 },
  roomList: { gap: Spacing.three, marginTop: Spacing.five, width: '100%' },
  roomCard: { minHeight: 112, borderRadius: 12, padding: Spacing.four, paddingLeft: Spacing.four + Spacing.one, overflow: 'hidden', gap: Spacing.two },
  roomAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: '#C8102E' },
  roomTitle: { fontSize: 24, lineHeight: 32 },
  viewButton: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 8, backgroundColor: '#C8102E', paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.one },
  viewButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  empty: { marginTop: Spacing.four, lineHeight: 21 },
});
