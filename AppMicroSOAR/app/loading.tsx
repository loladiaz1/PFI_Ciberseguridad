import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect } from "react";
import { router } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";

export default function LoadingScreen(){

useEffect(()=>{

setTimeout(()=>{

router.replace("/success");

},2500);

},[]);

return(

<View style={styles.container}>

<BrandLogo showText={false} />

<ActivityIndicator size="large"/>

<Text style={styles.title}>
Executing Mitigation...
</Text>

<Text style={styles.text}>
Connecting to Wazuh...
</Text>

<Text style={styles.text}>
Blocking malicious IP...
</Text>

<Text style={styles.text}>
Updating firewall...
</Text>

<Text style={styles.text}>
Saving audit log...
</Text>
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
marginVertical:25
},

text:{
marginTop:10,
color:Colors.textSecondary
}

});