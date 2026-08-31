import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";
import { blockIncidentIp } from "../services/api";

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

useEffect(()=>{

if (!id) return;

const start = Date.now();

blockIncidentIp(Number(id))
    .then((result) => {
        const elapsedMs = Date.now() - start;
        router.replace({
            pathname: "/success",
            params: { srcIp: result.srcIp, hostname, elapsedMs: String(elapsedMs) },
        });
    })
    .catch(() => {
        setError("Wazuh rejected the block command. Try again.");
    });

// eslint-disable-next-line react-hooks/exhaustive-deps -- solo se ejecuta una vez, al montar
},[id]);

return(

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

</View>

);

}

const styles=StyleSheet.create({

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
color:Colors.textSecondary
}

});
