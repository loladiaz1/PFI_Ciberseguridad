import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import Colors from "../styles/colors";
import BottomNav from "@/components/BottomNav";

export default function AuthScreen(){

const { id } = useLocalSearchParams<{ id: string }>();
const [error, setError] = useState("");

const authenticate = async () => {
    setError("");

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
        setError("No biometrics enrolled on this device. Set up Face ID / Fingerprint to continue.");
        return;
    }

    const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm it's you to block this IP",
    });

    if (result.success) {
        router.push({ pathname: "/confirm", params: { id } });
    } else if (result.error !== "user_cancel") {
        setError("Authentication failed. Try again.");
    }
};

return(

<View style={styles.container}>

<Text style={styles.icon}>🛡️</Text>

<Text style={styles.title}>
Step-Up Authentication
</Text>

<Text style={styles.subtitle}>
Authenticate with Face ID or Fingerprint
to continue.
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
Authenticate
</Text>

</TouchableOpacity>
<BottomNav />

</View>

);

}

const styles = StyleSheet.create({

  container:{
    flex:1,
    justifyContent:"center",
    alignItems:"center",
    backgroundColor:Colors.background,
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
