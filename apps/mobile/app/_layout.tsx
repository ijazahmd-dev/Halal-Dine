import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#047857' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="restaurant/[id]" options={{ title: 'Restaurant Details' }} />
        <Stack.Screen name="business/index" options={{ title: 'My Business Dashboard' }} />
        <Stack.Screen name="ownership/[restaurantId]" options={{ title: 'Claim Restaurant' }} />
        <Stack.Screen
          name="verification/[restaurantId]"
          options={{ title: 'Submit Halal Verification' }}
        />
        <Stack.Screen name="(auth)" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack>
    </>
  );
}
