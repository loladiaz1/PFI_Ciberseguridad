import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity
} from "react-native";

import { router } from "expo-router";

import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";

const recent = [

{
id:1,
title:"SSH Brute Force",
server:"SERVER-02",
severity:"Critical",
color:Colors.danger
},

{
id:2,
title:"Malicious IP",
server:"SERVER-05",
severity:"High",
color:Colors.primary
},

{
id:3,
title:"Port Scan",
server:"SERVER-08",
severity:"Medium",
color:Colors.warning
}

];

export default function Dashboard(){

return(

<View style={styles.container}>

<ScrollView>

<BrandLogo showText={false} />

<Text style={styles.greeting}>
Good Evening
</Text>

<Text style={styles.name}>
SOC Analyst
</Text>

<View style={styles.threatCard}>

<Text style={styles.threatTitle}>
Threat Level
</Text>

<Text style={styles.threat}>
🔴 HIGH
</Text>

<Text style={styles.subtitle}>
2 Critical Assets
</Text>

</View>

<View style={styles.row}>

<View style={styles.smallCard}>

<Text style={styles.number}>
4
</Text>

<Text style={styles.label}>
Incidents
</Text>

</View>

<View style={styles.smallCard}>

<Text style={styles.number}>
18
</Text>

<Text style={styles.label}>
Blocked
</Text>

</View>

</View>

<View style={styles.row}>

<View style={styles.smallCard}>

<Text style={styles.number}>
22
</Text>

<Text style={styles.label}>
Assets
</Text>

</View>

<View style={styles.smallCard}>

<Text style={styles.online}>
ONLINE
</Text>

<Text style={styles.label}>
Status
</Text>

</View>

</View>

<View style={styles.headerRow}>

<Text style={styles.section}>
Recent Incidents
</Text>

<TouchableOpacity
onPress={()=>router.push("/incidents")}
>

<Text style={styles.view}>
View all
</Text>

</TouchableOpacity>

</View>

{

recent.map(item=>(

<TouchableOpacity

key={item.id}

style={styles.incident}

onPress={()=>router.push("/incident")}

>

<View>

<Text style={styles.incidentTitle}>

{item.title}

</Text>

<Text style={styles.server}>

{item.server}

</Text>

</View>

<View>

<Text style={[styles.badge,{backgroundColor:item.color}]}>
{item.severity}
</Text>

</View>

</TouchableOpacity>

))

}

</ScrollView>

<BottomNav/>

</View>

);

}

const styles=StyleSheet.create({

container:{
flex:1,
backgroundColor:Colors.background,
paddingTop:60
},

greeting:{
color:Colors.textSecondary,
fontSize:18,
paddingHorizontal:20
},

name:{
color:Colors.text,
fontSize:34,
fontWeight:"bold",
paddingHorizontal:20,
marginBottom:25
},

threatCard:{
backgroundColor:Colors.primary,
marginHorizontal:20,
padding:22,
borderRadius:18
},

threatTitle:{
color:"white",
fontSize:18
},

threat:{
fontSize:34,
fontWeight:"bold",
color:"white",
marginTop:10
},

subtitle:{
marginTop:5,
color:"white"
},

row:{
flexDirection:"row",
justifyContent:"space-between",
marginHorizontal:20,
marginTop:18
},

smallCard:{
backgroundColor:Colors.card,
width:"47%",
padding:22,
borderRadius:18,
alignItems:"center"
},

number:{
color:Colors.text,
fontSize:32,
fontWeight:"bold"
},

online:{
fontSize:24,
fontWeight:"bold",
color:Colors.success
},

label:{
color:Colors.textSecondary,
marginTop:8
},

headerRow:{
marginHorizontal:20,
marginTop:35,
flexDirection:"row",
justifyContent:"space-between",
alignItems:"center"
},

section:{
fontSize:22,
fontWeight:"bold",
color:Colors.text
},

view:{
color:Colors.primary,
fontWeight:"600"
},

incident:{
backgroundColor:Colors.card,
marginHorizontal:20,
marginTop:15,
padding:20,
borderRadius:18,
flexDirection:"row",
justifyContent:"space-between",
alignItems:"center"
},

incidentTitle:{
fontSize:18,
fontWeight:"bold",
color:Colors.text
},

server:{
color:Colors.textSecondary,
marginTop:6
},

badge:{
paddingHorizontal:14,
paddingVertical:6,
borderRadius:20,
color:"white",
fontWeight:"bold"
}

});