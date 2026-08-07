import { Image, StyleSheet, Text, View } from 'react-native';

type BrandLogoProps = {
  size?: number;
  showText?: boolean;
};

export function BrandLogo({ size = 56, showText = true }: BrandLogoProps) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/images/logo.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
      {showText ? <View style={styles.textWrap}><Text style={styles.title}>Micro-SOAR</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  textWrap: {
    marginTop: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
});
