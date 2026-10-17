import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { isAxiosError } from "axios";
import { blockIncidentIp, isolateIncidentHost, quarantineIncidentEmail, restoreIncidentEmail } from "../services/api";
import type { MitigationAction } from "../types";
import { S } from "@/constants/strings";

// Solo cosmetico -- va revelando un mensaje a la vez mientras se espera la
// respuesta real de la API. No determina cuando navega: eso lo decide
// unicamente la llamada real a la API resolviendo o rechazando de verdad.
const STEP_DELAY = 600;

const RUN: Record<MitigationAction, (id: number, messageIds?: number[]) => Promise<unknown>> = {
    "block-ip": (id) => blockIncidentIp(id),
    "isolate-host": (id) => isolateIncidentHost(id),
    "quarantine-email": quarantineIncidentEmail,
    "restore-email": restoreIncidentEmail,
};

export default function LoadingScreen(){

const { id, action, target, messageIds } = useLocalSearchParams<{
    id: string;
    action: MitigationAction;
    target: string;
    messageIds?: string;
}>();
const [error, setError] = useState("");
const [visibleStep, setVisibleStep] = useState(0);

const steps = S.flow[action].steps(target);

useEffect(() => {
    if (visibleStep >= steps.length - 1) return;
    const timer = setTimeout(() => setVisibleStep((s) => s + 1), STEP_DELAY);
    return () => clearTimeout(timer);
// eslint-disable-next-line react-hooks/exhaustive-deps -- "steps" se recalcula cada render, solo importa visibleStep
}, [visibleStep]);

useEffect(()=>{

if (!id) return;

const start = Date.now();

RUN[action](Number(id), messageIds ? messageIds.split(",").map(Number) : undefined)
    .then(() => {
        const elapsedMs = Date.now() - start;
        router.replace({
            pathname: "/success",
            params: { id, action, target, elapsedMs: String(elapsedMs) },
        });
    })
    .catch((err) => {
        // El motivo del backend (ej. "No se encontró el correo en ningún buzón")
        // dice mas que un mensaje generico.
        const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
        setError(detail ? `${S.flow[action].rejected} ${detail}` : S.flow[action].rejected);
    });

// eslint-disable-next-line react-hooks/exhaustive-deps -- solo se ejecuta una vez, al montar
},[id]);

return(

<View style={styles.container}>

<BrandHeader />

<View style={styles.content}>

{error ? (
    <>
        <Text style={styles.title}>{S.mitigation.failed}</Text>
        <Text style={styles.text}>{error}</Text>
    </>
) : (
    <>
        <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />

        <Text style={styles.title}>
        {S.mitigation.executing}
        </Text>

        <View style={styles.stepWrap}>
            <Text style={styles.text}>{steps[visibleStep]}</Text>
        </View>
    </>
)}

</View>

<BottomNav />

</View>

);

}

const styles=StyleSheet.create({

container:{
flex:1,
backgroundColor:Colors.background,
paddingTop:60
},

content:{
flex:1,
justifyContent:"center",
alignItems:"center",
paddingHorizontal:25,
},

spinner:{
marginTop:20,
},

title:{
fontSize:28,
fontWeight:"bold",
marginVertical:25,
color:Colors.text
},

stepWrap:{
minHeight:26,
alignItems:"center",
},

text:{
marginTop:10,
color:Colors.textSecondary,
textAlign:"center",
lineHeight:22
}

});
