import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "@/components/BottomNav";

export default function AuthScreen(){

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

<TouchableOpacity
style={styles.button}
onPress={()=>router.push("/loading")}
>

<Text style={styles.buttonText}>
Simulate Authentication
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
