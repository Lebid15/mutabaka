import FeatherIcon from '@expo/vector-icons/Feather';
import { memo, useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useThemeMode } from '../theme';

export interface ConversationListItemProps {
  title: string;
  subtitle: string;
  time: string;
  unreadCount?: number;
  isPinned?: boolean;
  isMuted?: boolean;
  isActive?: boolean;
  avatarUri?: string;
  onPress?: () => void;
  onEditPress?: () => void;
  editLoading?: boolean;
}

function ConversationListItemBase({
  title,
  subtitle,
  time,
  unreadCount = 0,
  isPinned,
  isMuted,
  isActive,
  avatarUri,
  onPress,
  onEditPress,
  editLoading = false,
}: ConversationListItemProps) {
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const isUnread = unreadCount > 0;

  const avatarSource = useMemo(() => {
    if (avatarUri) {
      return { uri: avatarUri } as const;
    }
    const initials = title
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2) || 'م';
    return {
      uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=0D8ABC&color=fff&size=128&bold=true`,
    } as const;
  }, [avatarUri, title]);

  const dividerColor = isLight ? '#f1decf' : '#1f2a34';

  const containerStyle = [
    styles.container,
    {
      borderBottomColor: dividerColor,
      backgroundColor: isActive ? (isLight ? '#fff7ed' : '#10232b') : 'transparent',
    },
  ];

  const nameColor = isLight ? '#1f2937' : '#e2e8f0';
  const previewColor = isLight ? '#6b7280' : '#94a3b8';
  const timeColor = isLight ? '#9ca3af' : '#94a3b8';
  const badgeBg = isLight ? '#16a34a' : '#166534';
  const actionBg = isLight ? '#ffffff' : '#0f172a';
  const actionBorder = isLight ? '#e2d4c6' : '#233138';
  const actionIconColor = isLight ? '#475569' : '#cbd5f5';

  const handleEditPress = (event: GestureResponderEvent) => {
    if (event.stopPropagation) {
      event.stopPropagation();
    }
    if (editLoading) {
      return;
    }
    onEditPress?.();
  };

  return (
    <Pressable style={containerStyle} accessibilityRole="button" onPress={onPress}>
      <Image
        source={avatarSource}
        style={[
          styles.avatar,
          {
            borderColor: isLight ? '#f0d9c2' : '#233138',
            backgroundColor: isLight ? '#f8fafc' : '#0f172a',
          },
        ]}
        accessibilityIgnoresInvertColors
      />

      <View style={styles.info}>
        <View style={styles.topLine}>
          <View style={styles.nameWrap}>
            <Text style={[styles.nameText, { color: nameColor }]} numberOfLines={1}>
              {title}
            </Text>
            {isMuted ? <Text style={styles.mutedGlyph}>🔕</Text> : null}
            {isPinned ? (
              <FeatherIcon name="bookmark" size={14} color={isLight ? '#f97316' : '#facc15'} style={styles.pinIcon} />
            ) : null}
          </View>
          <Text style={[styles.timeText, { color: timeColor }]}>{time}</Text>
        </View>

        <View style={styles.previewRow}>
          <Text style={[styles.previewText, { color: previewColor }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.trailing}>
        {isUnread ? (
          <View style={[styles.unreadBadge, { backgroundColor: badgeBg }]}>
            <Text style={styles.unreadText}>{unreadCount}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={editLoading}
          onPress={handleEditPress}
          style={[styles.actionButton, { backgroundColor: actionBg, borderColor: actionBorder, opacity: editLoading ? 0.6 : 1 }]}
        >
          {editLoading ? (
            <ActivityIndicator size="small" color={actionIconColor} />
          ) : (
            <FeatherIcon name="edit-3" size={16} color={actionIconColor} />
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
  },
  info: {
    flex: 1,
    marginHorizontal: 14,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  nameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '80%',
  },
  nameText: {
    fontSize: 15,
    fontWeight: '600',
  },
  mutedGlyph: {
    fontSize: 14,
    marginStart: 4,
  },
  pinIcon: {
    marginStart: 6,
  },
  timeText: {
    fontSize: 11,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewText: {
    fontSize: 13,
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginStart: 8,
  },
  unreadBadge: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignItems: 'center',
    marginBottom: 8,
  },
  unreadText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});

const ConversationListItem = memo(ConversationListItemBase);

export default ConversationListItem;
