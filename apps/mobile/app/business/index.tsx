import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

export default function BusinessDashboardScreen() {
  const router = useRouter();

  const businessTools = [
    {
      title: 'Halal Verification Application',
      desc: 'Submit official certification & supplier affidavits',
      route: '/verification/demo',
      icon: '🛡️',
    },
    {
      title: 'Manage Restaurant Profile',
      desc: 'Update opening hours, contact details & bio',
      route: null,
      icon: '📝',
    },
    {
      title: 'Menu Management',
      desc: 'Add items, categories & pricing',
      route: null,
      icon: '📋',
    },
    {
      title: 'Restaurant Photos',
      desc: 'Upload high-resolution dining and kitchen photos',
      route: null,
      icon: '📸',
    },
    {
      title: 'Verification Status Tracking',
      desc: 'Track audit progress with Halal Dine verifiers',
      route: null,
      icon: '⏳',
    },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>🏢 My Business Portal</Text>
        <Text style={styles.bannerSubtitle}>
          Authorized management console for Paragon Restaurant (Kozhikode)
        </Text>
      </View>

      <Text style={styles.sectionHeader}>Management Tools</Text>

      {businessTools.map((tool, index) => (
        <TouchableOpacity
          key={index}
          style={styles.card}
          onPress={() => tool.route && router.push(tool.route as any)}
        >
          <Text style={styles.cardIcon}>{tool.icon}</Text>
          <View style={styles.cardTextContainer}>
            <Text style={styles.cardTitle}>{tool.title}</Text>
            <Text style={styles.cardSubtitle}>{tool.desc}</Text>
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
  banner: {
    backgroundColor: '#047857',
    borderRadius: 12,
    padding: 18,
    marginBottom: 20,
  },
  bannerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  bannerSubtitle: {
    color: '#d1fae5',
    fontSize: 12,
    marginTop: 4,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardIcon: {
    fontSize: 24,
    marginRight: 14,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
});
