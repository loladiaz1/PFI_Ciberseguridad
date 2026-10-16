import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../styles/colors";
import { BrandHeader } from "../components/ui/BrandHeader";
import { S } from "@/constants/strings";

// Aviso de privacidad (Ley 25.326, art. 6: informacion al titular de los
// datos). Accesible sin sesion (desde el registro) y desde el Perfil. El
// texto esta en constants/strings.ts.

export default function PrivacyScreen() {
    return (
        <View style={styles.container}>
            <BrandHeader />

            <ScrollView contentContainerStyle={styles.content}>
                <TouchableOpacity style={styles.back} onPress={() => router.back()}>
                    <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textSecondary} />
                    <Text style={styles.backText}>{S.common.back}</Text>
                </TouchableOpacity>

                <Text style={styles.title}>{S.privacy.title}</Text>
                <Text style={styles.subtitle}>{S.privacy.subtitle}</Text>

                {S.privacy.sections.map((section) => (
                    <View key={section.title} style={styles.card}>
                        <Text style={styles.cardTitle}>{section.title}</Text>
                        {section.body.map((paragraph) => (
                            <Text key={paragraph.slice(0, 40)} style={styles.paragraph}>
                                {paragraph}
                            </Text>
                        ))}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
        paddingTop: 60,
    },

    content: {
        padding: 20,
        paddingBottom: 40,
    },

    back: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 12,
    },

    backText: {
        color: Colors.textSecondary,
        fontWeight: "600",
    },

    title: {
        fontSize: 26,
        fontWeight: "bold",
        color: Colors.text,
    },

    subtitle: {
        color: Colors.textSecondary,
        marginTop: 4,
        marginBottom: 16,
    },

    card: {
        backgroundColor: Colors.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Colors.border,
        padding: 16,
        marginBottom: 12,
    },

    cardTitle: {
        color: Colors.primary,
        fontWeight: "700",
        fontSize: 16,
        marginBottom: 8,
    },

    paragraph: {
        color: Colors.text,
        lineHeight: 21,
        marginBottom: 8,
    },
});
