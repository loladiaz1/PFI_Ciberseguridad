import { Image, StyleSheet, Text, View } from "react-native";
import { useFonts, Roboto_700Bold } from "@expo-google-fonts/roboto";

import Colors from "../../styles/colors";

type BrandHeaderProps = {
  logoSize?: number;
};

export function BrandHeader({ logoSize = 64 }: BrandHeaderProps) {
  const [fontsLoaded] = useFonts({
    Roboto_700Bold,
  });

  return (
    <View style={styles.container}>
      {/* Logo y nombre centrados en la misma linea (antes el logo traia un
          margen inferior propio y el nombre quedaba corrido hacia abajo). */}
      <Image
        source={require("../../assets/images/logo.png")}
        style={{ width: logoSize, height: logoSize }}
        resizeMode="contain"
      />
      <Text style={[styles.brandName, fontsLoaded && styles.brandNameRoboto]}>Fortia</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    gap: 4,
  },

  brandName: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: 0.5,
  },

  brandNameRoboto: {
    fontFamily: "Roboto_700Bold",
  },
});
