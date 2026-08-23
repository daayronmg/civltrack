import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme';

/** Navegación principal: Inicio, Lista, Ruta, Alertas, Favoritos y Perfil. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 84,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={(color as string) ?? colors.textFaint} />,
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: 'Lista',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={(color as string) ?? colors.textFaint} />,
        }}
      />
      <Tabs.Screen
        name="route"
        options={{
          title: 'Ruta',
          tabBarIcon: ({ color, size }) => <Ionicons name="navigate" size={size} color={(color as string) ?? colors.textFaint} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alertas',
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications" size={size} color={(color as string) ?? colors.textFaint} />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Favoritos',
          tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={(color as string) ?? colors.textFaint} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={(color as string) ?? colors.textFaint} />,
        }}
      />
    </Tabs>
  );
}
