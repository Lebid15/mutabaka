declare module 'react-native-image-viewing' {
  import type { ComponentType } from 'react';
  import type { ImageProps, StyleProp, ViewStyle } from 'react-native';

  export interface ImageSource {
    uri: string;
    title?: string;
    [key: string]: unknown;
  }

  export interface ImageViewingProps {
    images: ImageSource[];
    imageIndex: number;
    visible: boolean;
    onRequestClose: () => void;
    swipeToCloseEnabled?: boolean;
    doubleTapToZoomEnabled?: boolean;
    backgroundColor?: string;
    animationType?: 'none' | 'fade-slide' | 'fade';
    HeaderComponent?: ComponentType<{ imageIndex: number }>;
    FooterComponent?: ComponentType<{ imageIndex: number }>;
    imageProps?: ImageProps;
    presentationStyle?: 'overFullScreen' | 'fullScreen' | 'pageSheet' | 'formSheet' | 'overFullScreen';
    keyExtractor?: (imageSrc: ImageSource, index: number) => string;
    onImageIndexChange?: (index: number) => void;
    delayLongPress?: number;
    doubleTapZoomEnabled?: boolean;
    swipeGestureEnabled?: boolean;
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
  }

  const ImageView: React.ComponentType<ImageViewingProps>;

  export default ImageView;
}
