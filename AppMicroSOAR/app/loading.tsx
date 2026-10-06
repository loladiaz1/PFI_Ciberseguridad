import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { blockIncidentIp } from "../services/api";
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";

// Solo cosmetico -- va revelando un mensaje a la vez mientras se espera la
// respuesta real de la API. No determina cuando navega: eso lo decide
// unicamente blockIncidentIp() resolviendo o rechazando de verdad.
const STEP_DELAY = 600;

export default function LoadingScreen(){

const { id, srcIp, hostname } = useLocalSearchParams<{ id: string; srcIp: string; hostname: string }>();
const [error, setError] = useState("");
const [visibleStep, setVisibleStep] = useState(0);

const steps = [
    "Connecting to Wazuh...",
    `Blocking ${srcIp}...`,
    "Updating firewall...",
];

useEffect(() => {
    if (visibleStep >= steps.length - 1) return;
    const timer = setTimeout(() => setVisibleStep((s) => s + 1), STEP_DELAY);
    return () => clearTimeout(timer);
// eslint-disable-next-line react-hooks/exhaustive-deps -- "steps" se recalcula cada render, solo importa visibleStep
}, [visibleStep]);

// TODO: reemplazar por el resultado real que devuelva tu API / acción de mitigación
const MOCK_SUCCESS = true;

// Colores propios para no depender de que existan en styles/colors.ts
const SUCCESS_COLOR = "#16a34a";
const ERROR_COLOR = "#dc2626";

export default function LoadingScreen() {
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [result, setResult] = useState<"pending" | "success" | "error">("pending");

  // Va revelando los mensajes de a uno
  useEffect(() => {
    if (visibleSteps < STEPS.length) {
      const timer = setTimeout(() => {
        setVisibleSteps((v) => v + 1);
      }, STEP_DELAY);
      return () => clearTimeout(timer);
    }

    const resultTimer = setTimeout(() => {
      setResult(MOCK_SUCCESS ? "success" : "error");
    }, RESULT_DELAY);
    return () => clearTimeout(resultTimer);
  }, [visibleSteps]);

  // Una vez que hay resultado, redirige después de un rato
  useEffect(() => {
    if (result === "pending") return;
    const redirectTimer = setTimeout(() => {
      router.replace("/success");
    }, REDIRECT_DELAY);
    return () => clearTimeout(redirectTimer);
  }, [result]);

<View style={styles.container}>

<BrandHeader logoSize={96} />

<View style={styles.content}>

{error ? (
    <>
        <Text style={styles.title}>Mitigation failed</Text>
        <Text style={styles.text}>{error}</Text>
    </>
) : (
    <>
        <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />

        <Text style={styles.title}>
        Executing Mitigation...
        </Text>

        <View style={styles.stepWrap}>
            <Text style={styles.text}>{steps[visibleStep]}</Text>
        </View>
    </>
)}

</View>

<BottomNav />

        <Text style={styles.title}>Executing Mitigation...</Text>

        <View style={styles.stepsWrap}>
          {visibleSteps > 0 && (
            <Text style={styles.text}>{STEPS[visibleSteps - 1]}</Text>
          )}
        </View>
      </View>

      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

container:{
flex:1,
backgroundColor:Colors.background
},

content:{
flex:1,
justifyContent:"center",
alignItems:"center",
},

spinner:{
marginTop:20,
},

  spinner: {
    marginTop: 20,
  },

stepWrap:{
minHeight:26,
alignItems:"center",
},

text:{
marginTop:10,
color:Colors.textSecondary
}

  stepsWrap: {
    minHeight: STEPS.length * 26,
    alignItems: "center",
  },

  text: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontSize: 15,
  },

  resultContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },

  resultTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#fff",
    marginTop: 20,
    textAlign: "center",
  },

  resultSubtitle: {
    fontSize: 15,
    color: "rgba(255,255,255,0.9)",
    marginTop: 10,
    textAlign: "center",
    lineHeight: 22,
  },
});