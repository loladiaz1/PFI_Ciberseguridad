import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import Colors from "../styles/colors";
import BottomNav from "@/components/BottomNav";
import { BrandHeader } from "@/components/ui/BrandHeader";
import type { MitigationAction } from "@/types";
import { S } from "@/constants/strings";

export default function AuthScreen(){

const { id, action } = useLocalSearchParams<{ id: string; action: MitigationAction }>();
const [error, setError] = useState("");

const authenticate = async () => {
    setError("");

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
        setError(S.biometrics.notEnrolled);
        return;
    }

    const result = await LocalAuthentication.authenticateAsync({
        promptMessage: S.flow[action].prompt,
    });

    if (result.success) {
        router.push({ pathname: "/confirm", params: { id, action } });
    } else if (result.error !== "user_cancel") {
        setError(S.stepUp.failed);
    }
};

return(

<View style={styles.container}>

<BrandHeader />

<View style={styles.content}>

<Text style={styles.icon}>🛡️</Text>

<Text style={styles.title}>
{S.stepUp.title}
</Text>

<Text style={styles.subtitle}>
{S.stepUp.subtitle}
</Text>

<Text style={styles.fingerprint}>
👆
</Text>

{error ? <Text style={styles.error}>{error}</Text> : null}

<TouchableOpacity
style={styles.button}
onPress={authenticate}
>

<Text style={styles.buttonText}>
{S.stepUp.submit}
</Text>

</TouchableOpacity>

</View>

<BottomNav />

</View>

);

}

const styles = StyleSheet.create({

  container:{
    flex:1,
    backgroundColor:Colors.background,
    paddingTop:60,
  },

  content:{
    flex:1,
    justifyContent:"center",
    alignItems:"center",
    padding:25
  },

  icon:{
    fontSize:55
  },

  title:{
    fontSize:30,
    fontWeight:"bold",
    marginTop:20,
    color:Colors.text
  },

  subtitle:{
    marginTop:20,
    textAlign:"center",
    color:Colors.textSecondary,
    lineHeight:24
  },

  fingerprint:{
    fontSize:90,
    marginVertical:45
  },

  error:{
    color:Colors.danger,
    textAlign:"center",
    marginBottom:20
  },

  button:{
    backgroundColor:Colors.primary,
    padding:18,
    width:"100%",
    borderRadius:14
  },

  buttonText:{
    textAlign:"center",
    fontWeight:"bold",
    color:Colors.text,
    fontSize:17
  }

});
