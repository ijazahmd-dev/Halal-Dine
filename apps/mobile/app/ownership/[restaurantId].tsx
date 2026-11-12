import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function OwnershipClaimScreen() {
  const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.headerTitle}>Ownership Verification Claim</Text>
      <Text style={styles.headerSubtitle}>
        Submit business proof to verify your management rights for restaurant {restaurantId}.
      </Text>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Full Name / Authorized Representative</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Muhammed Ali"
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Business Registration / GSTIN / FSSAI</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 32AAAAA0000A1Z5"
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Official Business Phone</Text>
        <TextInput
          style={styles.input}
          placeholder="+91 98470 00000"
          placeholderTextColor="#94a3b8"
          keyboardType="phone-pad"
        />
      </View>

      <TouchableOpacity style={styles.submitButton}>
        <Text style={styles.submitButtonText}>Submit Ownership Claim</Text>
      </TouchableOpacity>
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
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    marginBottom: 20,
    lineHeight: 18,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#0f172a',
  },
  submitButton: {
    marginTop: 10,
    backgroundColor: '#047857',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
