import { StyleSheet, Text, View } from "react-native";
import { useFonts, Roboto_700Bold } from "@expo-google-fonts/roboto";

import Colors from "../../styles/colors";
import { BrandLogo } from "../BrandLogo";

type BrandHeaderProps = {
  logoSize?: number;
};

export function BrandHeader({ logoSize = 64 }: BrandHeaderProps) {
  const [fontsLoaded] = useFonts({
    Roboto_700Bold,
  });

  return (
    <View style={styles.container}>
      <BrandLogo showText={false} size={logoSize} />
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
    gap: 10,
  },

  brandName: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text,
  },

  brandNameRoboto: {
    fontFamily: "Roboto_700Bold",
  },
});
