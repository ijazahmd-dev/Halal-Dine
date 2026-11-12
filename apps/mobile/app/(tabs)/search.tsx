import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';

export default function SearchScreen() {
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search restaurants, cuisines, districts..."
        placeholderTextColor="#94a3b8"
      />
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Search across Kerala districts (Kozhikode, Ernakulam, Malappuram...)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8fafc',
  },
  searchInput: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    fontSize: 14,
    color: '#0f172a',
  },
  placeholder: {
    marginTop: 40,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  placeholderText: {
    color: '#64748b',
    textAlign: 'center',
    fontSize: 14,
  },
});
