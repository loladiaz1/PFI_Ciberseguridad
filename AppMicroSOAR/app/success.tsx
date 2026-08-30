import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";

export default function SuccessScreen(){

const { srcIp, hostname, elapsedMs } = useLocalSearchParams<{
    srcIp: string;
    hostname: string;
    elapsedMs: string;
}>();

const seconds = elapsedMs ? (Number(elapsedMs) / 1000).toFixed(1) : "-";

return(

<View style={styles.container}>

<BrandHeader />

<Text style={styles.check}>
✅
</Text>

<Text style={styles.title}>
Mitigation Completed
</Text>

<Text style={styles.subtitle}>
The malicious IP has been successfully blocked.
</Text>

<View style={styles.card}>

<Text style={styles.label}>
Blocked IP
</Text>

<Text style={styles.value}>
{srcIp}
</Text>

<Text style={styles.label}>
Target
</Text>

<Text style={styles.value}>
{hostname}
</Text>

<Text style={styles.label}>
Execution Time
</Text>

<Text style={styles.value}>
{seconds} seconds
</Text>

</View>

<TouchableOpacity
style={styles.button}
onPress={()=>router.replace("/dashboard")}
>

<Text style={styles.buttonText}>
Back to Dashboard
</Text>

</TouchableOpacity>
<BottomNav />

</View>

);

}
const styles = StyleSheet.create({

  container:{
    flex:1,
    backgroundColor:Colors.background,
    justifyContent:"center",
    padding:25
  },

  check:{
    fontSize:70,
    textAlign:"center"
  },

  title:{
    fontSize:32,
    fontWeight:"bold",
    textAlign:"center",
    marginTop:15,
    color:Colors.text
  },

  subtitle:{
    textAlign:"center",
    marginVertical:20,
    color:Colors.textSecondary
  },

  card:{
    backgroundColor:Colors.card,
    padding:20,
    borderRadius:15,
    borderWidth:1,
    borderColor:Colors.border
  },

  label:{
    marginTop:15,
    color:Colors.textSecondary
  },

  value:{
    fontSize:18,
    fontWeight:"600",
    color:Colors.text
  },

  button:{
    marginTop:35,
    backgroundColor:Colors.success,
    padding:18,
    borderRadius:14
  },

  buttonText:{
    textAlign:"center",
    color:Colors.text,
    fontWeight:"bold",
    fontSize:18
  }

});
