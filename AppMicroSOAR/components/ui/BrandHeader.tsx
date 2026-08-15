import { StyleSheet, Text, View } from "react-native";
import { useFonts, Roboto_700Bold } from "@expo-google-fonts/roboto";

import Colors from "../../styles/colors";
import { BrandLogo } from "../BrandLogo";

type BrandHeaderProps = {
  logoSize?: number;
};

export function BrandHeader({ logoSize = 140 }: BrandHeaderProps) {
  const [fontsLoaded] = useFonts({
    Roboto_700Bold,
  });

  return (
    <View style={styles.container}>
      <BrandLogo showText={false} size={logoSize} />
      <Text style={[styles.brandName, fontsLoaded && styles.brandNameRoboto]}>
        Fortia
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: -10,
    marginLeft: -24,
    marginBottom: 8,
  },

  brandName: {
    fontSize: 22,
    fontWeight: "bold",
    color: Colors.primary,
    marginLeft: -18,
  },

  brandNameRoboto: {
    fontFamily: "Roboto_700Bold",
  },
});