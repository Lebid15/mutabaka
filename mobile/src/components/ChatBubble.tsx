import { memo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { cn } from '../utils/cn';
import { useThemeMode } from '../theme';

interface ChatBubbleProps {
  message: string;
  time: string;
  isMine?: boolean;
  status?: 'sent' | 'delivered' | 'read';
}

function ChatBubbleBase({ message, time, isMine, status }: ChatBubbleProps) {
  const { mode } = useThemeMode();

  const container = cn(
    'max-w-[80%] rounded-3xl px-4 py-3 mb-3 shadow-sm',
    isMine
      ? mode === 'light'
        ? 'self-end bg-bubbleSentLight'
        : 'self-end bg-bubbleSentDark'
      : mode === 'light'
        ? 'self-start bg-bubbleReceivedLight'
        : 'self-start bg-bubbleReceivedDark',
  );

  const timeColor = isMine
    ? mode === 'light' ? '#7c4a21' : '#a7f3d0'
    : mode === 'light' ? '#8c6d52' : '#94a3b8';

  const showTicks = Boolean(status);
  const readColor = mode === 'light' ? '#38bdf8' : '#60a5fa';
  const unreadColor = mode === 'light' ? '#7f6538ff' : '#a8a59aff';

  return (
    <View className={container}>
      <Text className={cn('text-base leading-6', mode === 'light' ? 'text-textBrown' : 'text-textLight')}>
        {message}
      </Text>
      <View className="flex-row justify-end gap-1 mt-1 items-center">
        <Text className="text-[11px]" style={{ color: timeColor }}>
          {time}
        </Text>
  {showTicks ? <MessageTicks color={status === 'read' ? readColor : unreadColor} /> : null}
      </View>
    </View>
  );
}

const ChatBubble = memo(ChatBubbleBase);

export default ChatBubble;

function MessageTicks({ color }: { color: string }) {
  return (
    <Svg width={22} height={18} viewBox="0 0 32 24" fill="none">
      <Path
        d="M30 6L18 18l-5-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M23 6L11 18l-5-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
