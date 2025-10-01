import FeatherIcon from '@expo/vector-icons/Feather';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '../theme';

interface WalletSettlementCardProps {
  label?: string;
  timestamp?: string;
  highlightQuery?: string;
  highlightActive?: boolean;
}

const DEFAULT_LABEL = 'الحساب صفر';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WalletSettlementCard = memo(({ label, timestamp, highlightQuery, highlightActive }: WalletSettlementCardProps) => {
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const normalizedLabel = (label && label.trim()) || DEFAULT_LABEL;
  const normalizedQuery = highlightQuery?.trim();

  const labelSegments = useMemo(() => {
    if (!normalizedQuery) {
      return [{ text: normalizedLabel, highlighted: false }];
    }
    try {
      const regex = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'gi');
      const chunks = normalizedLabel.split(regex);
      return chunks.map((chunk, index) => ({
        text: chunk,
        highlighted: index % 2 === 1,
      }));
    } catch {
      return [{ text: normalizedLabel, highlighted: false }];
    }
  }, [normalizedLabel, normalizedQuery]);

  const containerStyles = [
    styles.container,
    {
      backgroundColor: isLight ? '#fde8d8' : 'rgba(255, 255, 255, 0.08)',
      borderColor: isLight ? '#f5c7a5' : 'rgba(148, 163, 184, 0.35)',
    },
    highlightActive ? (isLight ? styles.containerActiveLight : styles.containerActiveDark) : null,
  ];

  const titleColor = isLight ? '#047857' : '#bbf7d0';
  const subtitleColor = isLight ? 'rgba(30, 41, 59, 0.64)' : 'rgba(226, 232, 240, 0.7)';
  const iconColor = isLight ? '#10b981' : '#86efac';

  return (
    <View style={containerStyles}>
      <FeatherIcon name="file-text" size={48} color={iconColor} style={styles.icon} />
      <Text style={[styles.title, { color: titleColor }]}>
        {labelSegments.map((segment, index) => (
          <Text
            key={`${segment.text}-${index}`}
            style={segment.highlighted ? styles.highlight : undefined}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
      <Text style={[styles.timestamp, { color: subtitleColor }]}>{timestamp || '—'}</Text>
    </View>
  );
});

WalletSettlementCard.displayName = 'WalletSettlementCard';

const styles = StyleSheet.create({
  container: {
    minWidth: 220,
    maxWidth: 320,
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  containerActiveLight: {
    borderColor: '#f59e0b',
    shadowOpacity: 0.18,
    transform: [{ scale: 1.01 }],
  },
  containerActiveDark: {
    borderColor: '#facc15',
    shadowOpacity: 0.24,
    transform: [{ scale: 1.01 }],
  },
  icon: {
    marginBottom: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  highlight: {
    backgroundColor: 'rgba(250, 204, 21, 0.2)',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  timestamp: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default WalletSettlementCard;
