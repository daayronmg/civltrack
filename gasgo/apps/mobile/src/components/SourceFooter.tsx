import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SOURCE_ATTRIBUTION } from '@gasgo/core';
import { colors, spacing } from '../theme';

/**
 * Atribución obligatoria por las condiciones de reutilización de los datos (Ley 37/2007).
 * Debe aparecer allí donde se muestran precios.
 */
export function SourceFooter({ snapshotAt }: { snapshotAt?: string | null }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{SOURCE_ATTRIBUTION}</Text>
      {snapshotAt ? (
        <Text style={styles.date}>
          Última actualización de la fuente: {new Date(snapshotAt).toLocaleString('es-ES')}
        </Text>
      ) : null}
      <Text style={styles.date}>
        El precio es el último comunicado por cada estación a la Administración. Puede no incluir
        descuentos de tarjetas de fidelización.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.xs },
  text: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  date: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
});
