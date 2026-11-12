import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { HalalVerificationStatus } from '@halal-dine/contracts';
import { formatDistance } from '@halal-dine/utils';

export default function DiscoverScreen() {
  const router = useRouter();

  const mockRestaurants = [
    {
      id: 'rest-1',
      name: 'Paragon Restaurant',
      district: 'Kozhikode',
      status: HalalVerificationStatus.VERIFIED_HALAL,
      distanceMeters: 450,
    },
    {
      id: 'rest-2',
      name: 'Rahmath Hotel',
      district: 'Kozhikode',
      status: HalalVerificationStatus.RESTAURANT_CLAIMS_HALAL,
      distanceMeters: 1200,
    },
    {
      id: 'rest-3',
      name: 'Seagull Restaurant',
      district: 'Ernakulam',
      status: HalalVerificationStatus.UNVERIFIED,
      distanceMeters: 8500,
    },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Halal Dine</Text>
        <Text style={styles.subtitle}>Kerala Halal Restaurant Discovery</Text>
      </View>

      <View style={styles.locationBanner}>
        <Text style={styles.locationText}>📍 Current District: Kozhikode, Kerala</Text>
      </View>

      <Text style={styles.sectionTitle}>Nearby Restaurants</Text>

      {mockRestaurants.map((restaurant) => (
        <TouchableOpacity
          key={restaurant.id}
          style={styles.card}
          onPress={() => router.push(`/restaurant/${restaurant.id}` as any)}
        >
          <View style={styles.cardRow}>
            <Text style={styles.restaurantName}>{restaurant.name}</Text>
            <Text style={styles.distanceText}>{formatDistance(restaurant.distanceMeters)}</Text>
          </View>
          <Text style={styles.districtText}>{restaurant.district}, Kerala</Text>

          <View style={styles.badgeContainer}>
            <View
              style={[
                styles.badge,
                restaurant.status === HalalVerificationStatus.VERIFIED_HALAL
                  ? styles.badgeVerified
                  : restaurant.status === HalalVerificationStatus.RESTAURANT_CLAIMS_HALAL
                    ? styles.badgeClaimed
                    : styles.badgeUnverified,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  restaurant.status === HalalVerificationStatus.VERIFIED_HALAL
                    ? styles.badgeTextVerified
                    : styles.badgeTextDark,
                ]}
              >
                {restaurant.status.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
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
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  locationBanner: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 20,
  },
  locationText: {
    color: '#065f46',
    fontWeight: '600',
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  restaurantName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#047857',
  },
  districtText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  badgeContainer: {
    marginTop: 10,
    flexDirection: 'row',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeVerified: {
    backgroundColor: '#047857',
  },
  badgeClaimed: {
    backgroundColor: '#fef3c7',
  },
  badgeUnverified: {
    backgroundColor: '#f1f5f9',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  badgeTextVerified: {
    color: '#ffffff',
  },
  badgeTextDark: {
    color: '#334155',
  },
});
