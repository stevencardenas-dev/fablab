import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getAllItems, Rooms, SinUbicacion, type InventoryItem } from '@/lib/inventory';

export default function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      getAllItems().then(setItems);
    }, []),
  );

  const counts = countByRoom(items);
  const sections = [...Rooms, ...(counts.get(SinUbicacion) ? [SinUbicacion] : [])];

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.content}>
          <ThemedText type="title" style={styles.title}>Inventario</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.intro}>Elementos registrados en el FabLab UFPS.</ThemedText>

          <View style={styles.roomList}>
            {sections.map((room) => {
              const count = counts.get(room) ?? 0;
              return (
                <ThemedView key={room} type="backgroundElement" style={styles.roomCard}>
                  <View style={styles.roomAccent} />
                  <ThemedText type="subtitle" style={styles.roomTitle}>{room}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {count === 0 ? 'Sin elementos registrados.' : `${count} elemento${count === 1 ? '' : 's'}`}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/sala/[nombre]', params: { nombre: room } })}
                    style={styles.viewButton}>
                    <ThemedText style={styles.viewButtonLabel}>Ver</ThemedText>
                  </Pressable>
                </ThemedView>
              );
            })}
          </View>
        </SafeAreaView>
      </ScrollView>
    </ThemedView>
  );
}

function countByRoom(items: InventoryItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = (Rooms as readonly string[]).includes(item.inventario) ? item.inventario : SinUbicacion;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  title: { color: '#C8102E', marginTop: Spacing.six },
  intro: { marginTop: Spacing.one },
  roomList: { gap: Spacing.three, marginTop: Spacing.five },
  roomCard: { minHeight: 112, borderRadius: 12, padding: Spacing.four, paddingLeft: Spacing.four + Spacing.one, overflow: 'hidden', gap: Spacing.two },
  roomAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: '#C8102E' },
  roomTitle: { fontSize: 24, lineHeight: 32 },
  viewButton: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 8, backgroundColor: '#C8102E', paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.one },
  viewButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
