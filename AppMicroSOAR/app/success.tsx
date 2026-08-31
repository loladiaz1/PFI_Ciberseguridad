import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFonts, Roboto_600SemiBold, Roboto_700Bold } from "@expo-google-fonts/roboto";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandHeader } from "../components/ui/BrandHeader";

export default function SuccessScreen(){

const { srcIp, hostname, elapsedMs } = useLocalSearchParams<{
    srcIp: string;
    hostname: string;
    elapsedMs: string;
}>();

const [fontsLoaded] = useFonts({ Roboto_600SemiBold, Roboto_700Bold });

const seconds = elapsedMs ? (Number(elapsedMs) / 1000).toFixed(1) : "-";

return(

<View style={styles.container}>

<BrandHeader />

<ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

<MaterialCommunityIcons
    name="check-circle"
    size={90}
    color={Colors.success}
    style={styles.icon}
/>

<Text style={[styles.title, fontsLoaded && styles.titleRoboto]}>
Mitigation Completed
</Text>

<Text style={styles.subtitle}>
The malicious IP has been successfully blocked.
</Text>

<View style={styles.card}>

<Text style={styles.label}>
Blocked IP
</Text>

<Text style={[styles.value, fontsLoaded && styles.valueRoboto]}>
{srcIp}
</Text>

<Text style={styles.label}>
Target
</Text>

<Text style={[styles.value, fontsLoaded && styles.valueRoboto]}>
{hostname}
</Text>

<Text style={styles.label}>
Execution Time
</Text>

<Text style={[styles.value, fontsLoaded && styles.valueRoboto]}>
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

</ScrollView>

<BottomNav />

</View>

);

}
const styles = StyleSheet.create({

  container:{
    flex:1,
    backgroundColor:Colors.background,
  },

  scroll:{
    flex:1,
  },

  content:{
    flexGrow:1,
    justifyContent:"center",
    padding:25,
  },

  icon:{
    alignSelf:"center",
    marginTop:10,
  },

  title:{
    fontSize:32,
    fontWeight:"bold",
    textAlign:"center",
    marginTop:15,
    color:Colors.text
  },

  titleRoboto:{
    fontFamily:"Roboto_700Bold",
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

  valueRoboto:{
    fontFamily:"Roboto_600SemiBold",
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
