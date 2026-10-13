import { Stack } from "expo-router";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Colors from "../styles/colors";

// Destellos blancos al navegar: las pantallas ya tenian fondo oscuro, pero
// lo que asoma mientras una se monta es lo que esta DETRAS:
//   1) la ventana nativa (blanca por default) -> SystemUI
//   2) los contenedores del navegador, que sin ThemeProvider usan el tema
//      claro de React Navigation -> ThemeProvider con los colores de la app
SystemUI.setBackgroundColorAsync(Colors.background);

const theme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        primary: Colors.primary,
        background: Colors.background,
        card: Colors.card,
        text: Colors.text,
        border: Colors.border,
    },
};

export default function Layout() {

    return (

        <ThemeProvider value={theme}>
            <SafeAreaProvider>
                <Stack
                    screenOptions={{
                        headerShown: false,
                        animation: "none"
                    }}
                />
            </SafeAreaProvider>
        </ThemeProvider>

    );

}
