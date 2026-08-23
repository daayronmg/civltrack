import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatPrice } from '@gasgo/core';
import { colors, priceColor, radius, shadow } from '../theme';

interface Props {
  price: number;
  /** 0 = el más barato del entorno visible, 1 = el más caro. */
  ratio: number;
  /** Resalta el marcador de la gasolinera más barata. */
  isCheapest?: boolean;
  selected?: boolean;
}

/**
 * Marcador con el precio directamente encima, como pide el diseño:
 *
 *     ⛽
 *   1,489 €
 *
 * Es un componente puro y memorizado: en el mapa puede haber decenas a la vez.
 */
export const PriceMarker = memo(function PriceMarker({ price, ratio, isCheapest, selected }: Props) {
  const background = isCheapest ? colors.priceBest : priceColor(ratio);
  const dark = background === colors.priceBest || background === colors.priceGood || background === colors.priceMid;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: background },
          selected && styles.bubbleSelected,
          isCheapest && styles.bubbleCheapest,
        ]}
      >
        {isCheapest ? <Text style={styles.crown}>🏆</Text> : null}
        <Text style={[styles.price, { color: dark ? '#04140D' : '#FFFFFF' }]} numberOfLines={1}>
          {formatPrice(price)}
        </Text>
      </View>
      <View style={[styles.pointer, { borderTopColor: background }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    ...shadow.marker,
  },
  bubbleSelected: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.15 }],
  },
  bubbleCheapest: {
    borderColor: '#FFFFFF',
  },
  crown: { fontSize: 11 },
  price: { fontSize: 14, fontWeight: '800', letterSpacing: -0.3 },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
});
