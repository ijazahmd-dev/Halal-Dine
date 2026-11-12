import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { HalalVerificationStatus } from '@halal-dine/contracts';

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.restaurantName}>Paragon Restaurant</Text>
        <Text style={styles.restaurantLocation}>Kozhikode, Kerala &bull; CH Flyover Junction</Text>

        <View style={styles.statusBadge}>
          <Text style={styles.statusBadgeText}>
            STATUS: {HalalVerificationStatus.VERIFIED_HALAL}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Halal Verification Credentials</Text>
        <Text style={styles.bodyText}>
          Independently verified against formal compliance standards. Documentation audited by Halal
          Dine verifiers.
        </Text>
      </View>

      {/* Claim Restaurant Section */}
      <View style={styles.claimSection}>
        <Text style={styles.claimTitle}>Are you the owner of this restaurant?</Text>
        <Text style={styles.claimSubtitle}>
          Claim your listing to manage menus, update timings, and verify halal credentials.
        </Text>
        <TouchableOpacity
          style={styles.claimButton}
          onPress={() => router.push(`/ownership/${id || 'demo'}` as any)}
        >
          <Text style={styles.claimButtonText}>Claim This Restaurant</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  restaurantName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  restaurantLocation: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  statusBadge: {
    marginTop: 14,
    backgroundColor: '#047857',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  claimSection: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  claimTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1e3a8a',
  },
  claimSubtitle: {
    fontSize: 12,
    color: '#3b82f6',
    marginTop: 4,
    lineHeight: 16,
  },
  claimButton: {
    marginTop: 12,
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  claimButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
