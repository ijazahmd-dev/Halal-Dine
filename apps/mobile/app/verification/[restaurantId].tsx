import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function VerificationSubmissionScreen() {
  const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Submit Halal Verification</Text>
      <Text style={styles.subtitle}>
        Upload official halal certificates, certifying authority details, and meat supplier invoices
        for verification case review.
      </Text>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Certifying Body / Authority</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Samastha / Jamiat / Recognized Board"
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Certificate Number / Registration</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. HALAL-KL-2026-0042"
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.uploadBox}>
        <Text style={styles.uploadIcon}>📄</Text>
        <Text style={styles.uploadTitle}>Attach Certificate & Invoices (PDF/JPG)</Text>
        <Text style={styles.uploadSubtitle}>Documents are stored in a private secure bucket</Text>
      </View>

      <TouchableOpacity style={styles.submitBtn}>
        <Text style={styles.submitBtnText}>Submit for Human Verification</Text>
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
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  subtitle: {
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
  uploadBox: {
    borderWidth: 2,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    marginVertical: 10,
  },
  uploadIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  uploadTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#334155',
  },
  uploadSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  submitBtn: {
    marginTop: 16,
    backgroundColor: '#047857',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
