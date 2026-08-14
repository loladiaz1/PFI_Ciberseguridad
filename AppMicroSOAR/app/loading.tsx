import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";
import { blockIncidentIp } from "../services/api";

export default function LoadingScreen(){

const { id, srcIp, hostname } = useLocalSearchParams<{ id: string; srcIp: string; hostname: string }>();
const [error, setError] = useState("");

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

<BrandLogo showText={false} />

{error ? (
    <>
        <Text style={styles.title}>Mitigation failed</Text>
        <Text style={styles.text}>{error}</Text>
    </>
) : (
    <>
        <ActivityIndicator size="large"/>

        <Text style={styles.title}>
        Executing Mitigation...
        </Text>

        <Text style={styles.text}>
        Connecting to Wazuh...
        </Text>

        <Text style={styles.text}>
        Blocking {srcIp}...
        </Text>

        <Text style={styles.text}>
        Updating firewall...
        </Text>
    </>
)}
<BottomNav />

</View>

);

}

const styles=StyleSheet.create({

container:{
flex:1,
justifyContent:"center",
alignItems:"center",
backgroundColor:Colors.background
},

title:{
fontSize:28,
fontWeight:"bold",
marginVertical:25,
color:Colors.text
},

text:{
marginTop:10,
color:Colors.textSecondary
}

});
