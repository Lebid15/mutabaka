import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { storeAuthTokens, type AuthTokens } from '../lib/authStorage';
import { clearAll } from '../lib/pinSession';
import type { RootStackParamList } from '../navigation';
import { fetchCurrentUser } from '../services/user';
import { fetchPinStatus } from '../services/pin';
import type { PinStatusPayload } from '../lib/pinSession';

interface PostLoginResult {
  pinStatus: PinStatusPayload;
  displayName: string | null;
  username: string | null;
  userId: number;
}

export async function preparePostLogin(tokens: AuthTokens): Promise<PostLoginResult> {
  await storeAuthTokens(tokens);
  const [user, pinStatus] = await Promise.all([fetchCurrentUser(), fetchPinStatus()]);
  return {
    pinStatus,
    displayName: user.display_name ?? user.username ?? null,
    username: user.username ?? null,
    userId: user.id,
  };
}

export async function navigateAfterLogin(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  tokens: AuthTokens,
): Promise<void> {
  const result = await preparePostLogin(tokens);
  if (!result.pinStatus.pin_enabled) {
    await clearAll({ keepTokens: true });
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    return;
  }
  await clearAll({ keepTokens: true });
  navigation.reset({
    index: 0,
    routes: [
      {
        name: 'PinSetup',
        params: {
          userId: result.userId,
          tokens,
          pinStatus: result.pinStatus,
          displayName: result.displayName,
          username: result.username,
          mode: 'initial',
        },
      },
    ],
  });
}
