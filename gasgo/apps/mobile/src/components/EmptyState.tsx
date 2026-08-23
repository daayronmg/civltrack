import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, TOUCH_TARGET } from '../theme';

interface Props {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}

/** Estado vacío honesto: si no hay datos, se dice por qué. Nunca se rellena con inventos. */
export function EmptyState({ icon = '⛽', title, message, actionLabel, onAction, loading }: Props) {
  return (
    <View style={styles.container}>
      {loading ? <ActivityIndicator color={colors.primary} size="large" /> : <Text style={styles.icon}>{icon}</Text>}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  icon: { fontSize: 44 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },
});
