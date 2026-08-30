import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity
} from "react-native";

import { router } from "expo-router";
import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

import Colors from "@/styles/colors";
import { BrandHeader } from "@/components/ui/BrandHeader";
import { getIncidents } from "@/services/api";
import { severityLabel } from "@/utils/severity";
import type { Incident } from "@/types";

export default function Dashboard(){

const [incidents, setIncidents] = useState<Incident[]>([]);

useFocusEffect(
    useCallback(() => {
        let cancelled = false;
        getIncidents()
            .then(({ data }) => {
                if (!cancelled) setIncidents(data);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [])
);

const recent = incidents.slice(0, 3);
const openIncidents = incidents.filter((i) => i.status === "new");
const openCount = openIncidents.length;
const blockedCount = incidents.filter((i) => i.status === "blocked").length;

const highestOpenSeverity = openIncidents.reduce(
    (max, i) => Math.max(max, i.severity),
    0
);
const threatLevel = openCount > 0 ? severityLabel(highestOpenSeverity) : null;

return(

<View style={styles.container}>

<ScrollView>

<BrandHeader />

<Text style={styles.greeting}>
Good Evening
</Text>

<Text style={styles.name}>
SOC Analyst
</Text>

<View style={[styles.threatCard, threatLevel && { backgroundColor: threatLevel.color }]}>

<Text style={styles.threatTitle}>
Threat Level
</Text>

<Text style={styles.threat}>
{threatLevel ? threatLevel.label : "CLEAR"}
</Text>

<Text style={styles.subtitle}>
{openCount} open incident{openCount === 1 ? "" : "s"}
</Text>

</View>

<View style={styles.row}>

<View style={styles.smallCard}>

<Text style={styles.number}>
{openCount}
</Text>

<Text style={styles.label}>
Incidents
</Text>

</View>

<View style={styles.smallCard}>

<Text style={styles.number}>
{blockedCount}
</Text>

<Text style={styles.label}>
Blocked
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

recent.map(item=>{

const severity = severityLabel(item.severity);

return (

<TouchableOpacity

key={item.id}

style={styles.incident}

onPress={()=>router.push({ pathname: "/incident", params: { id: String(item.id) } })}

>

<View>

<Text style={styles.incidentTitle}>

{item.hostname}

</Text>

<Text style={styles.server}>

{item.srcIp}

</Text>

</View>

<View>

<Text style={[styles.badge,{backgroundColor:severity.color}]}>
{severity.label}
</Text>

</View>

</TouchableOpacity>

);

})

}

</ScrollView>

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
