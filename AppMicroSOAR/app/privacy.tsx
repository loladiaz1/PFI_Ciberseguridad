import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../styles/colors";
import { BrandHeader } from "../components/ui/BrandHeader";

// Aviso de privacidad (Ley 25.326, art. 6: informacion al titular de los
// datos). En espanol a proposito: es el texto legal para usuarios en
// Argentina. Accesible sin sesion (desde el registro) y desde el Perfil.
// Lo que dice tiene que coincidir con lo implementado en
// orchestrator/src/privacy.js (supresion, seudonimizacion, retencion).
const SECTIONS: { title: string; body: string[] }[] = [
    {
        title: "Responsable y finalidad",
        body: [
            "Micro-SOAR trata datos personales con una única finalidad: la detección y respuesta a incidentes de seguridad informática por parte del equipo de seguridad que opera la plataforma.",
            "Responsable de la base de datos: Fortia Micro-SOAR.",
        ],
    },
    {
        title: "Qué datos se tratan",
        body: [
            "Del analista: usuario, nombre, email y rol; y el registro de auditoría de las acciones que ejecuta (inicio de sesión, bloqueo de IP, aislamiento de equipos), con fecha y hora. Este registro es necesario para la trazabilidad de las acciones críticas de seguridad.",
            "En el dispositivo: el token de sesión, guardado en el almacenamiento seguro del sistema operativo.",
            "Biometría: la huella o el rostro los valida el sistema operativo del celular. Micro-SOAR no recibe, guarda ni transmite datos biométricos.",
            "De terceros: la dirección IP de origen de un ataque detectado, que puede identificar a una persona. Se usa solo para contener el ataque.",
        ],
    },
    {
        title: "Destinatarios y transferencias",
        body: [
            "La IP de origen de un ataque se consulta en servicios de reputación de amenazas (VirusTotal y AbuseIPDB) para evaluar su riesgo.",
            "La plataforma se aloja en Amazon Web Services (región us-east-1, Estados Unidos).",
            "Los datos no se ceden a terceros con otra finalidad.",
        ],
    },
    {
        title: "Plazo de conservación",
        body: [
            "Las IPs de origen de los ataques se enmascaran (se conserva solo la red, por ejemplo 203.0.113.0/24) y se descarta la información de reputación asociada a los 90 días del incidente.",
            "El perfil del analista se conserva mientras la cuenta exista.",
        ],
    },
    {
        title: "Tus derechos",
        body: [
            "Acceso y rectificación: podés ver y editar tu nombre y email desde Perfil.",
            "Supresión: desde Perfil → \"Delete account\" eliminás tu perfil. El registro de auditoría de seguridad no se borra, pero se anonimiza: deja de identificarte.",
        ],
    },
    {
        title: "Información legal",
        body: [
            "El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326.",
            "La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.",
        ],
    },
];

export default function PrivacyScreen() {
    return (
        <View style={styles.container}>
            <BrandHeader />

            <ScrollView contentContainerStyle={styles.content}>
                <TouchableOpacity style={styles.back} onPress={() => router.back()}>
                    <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textSecondary} />
                    <Text style={styles.backText}>Back</Text>
                </TouchableOpacity>

                <Text style={styles.title}>Política de privacidad</Text>
                <Text style={styles.subtitle}>Protección de datos personales — Ley Nº 25.326</Text>

                {SECTIONS.map((section) => (
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
