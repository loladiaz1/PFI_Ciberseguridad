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
import { REFRESH_MS } from "@/constants/refresh";
import { S } from "@/constants/strings";

export default function Dashboard(){

const [incidents, setIncidents] = useState<Incident[]>([]);

useFocusEffect(
    useCallback(() => {
        let cancelled = false;
        const load = () =>
            getIncidents()
                .then(({ data }) => {
                    if (!cancelled) setIncidents(data);
                })
                .catch(() => {});

        // Mismo refresco que la lista de incidentes (ver REFRESH_MS).
        load();
        const timer = setInterval(load, REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [])
);

const recent = incidents.slice(0, 3);
// El ciclo del caso: por atender (sin contener; incluye un correo restaurado)
// -> por cerrar (contenido, falta el veredicto) -> cerrado.
const isContained = (i: Incident) => i.status === "blocked" || i.status === "isolated" || i.status === "quarantined";
const openIncidents = incidents.filter((i) => !i.closedAt && !isContained(i));
const openCount = openIncidents.length;
const toCloseCount = incidents.filter((i) => !i.closedAt && isContained(i)).length;
const today = new Date().toDateString();
const closedTodayCount = incidents.filter((i) => i.closedAt && new Date(i.closedAt).toDateString() === today).length;
const cards = [
    { count: openCount, label: S.dashboard.toAttend, view: "toAttend" },
    { count: toCloseCount, label: S.dashboard.toClose, view: "toClose" },
    { count: closedTodayCount, label: S.dashboard.closedToday, view: "closed" },
];

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
{S.dashboard.greeting}
</Text>

<Text style={styles.name}>
{S.dashboard.role}
</Text>

<View style={[styles.threatCard, threatLevel && { backgroundColor: threatLevel.color }]}>

<Text style={styles.threatTitle}>
{S.dashboard.threatLevel}
</Text>

<Text style={styles.threat}>
{threatLevel ? threatLevel.label : S.dashboard.clear}
</Text>

<Text style={styles.subtitle}>
{S.dashboard.openIncidents(openCount)}
</Text>

</View>

<View style={styles.row}>

{cards.map((card) => (
<TouchableOpacity
key={card.view}
style={styles.smallCard}
onPress={()=>router.push({ pathname: "/incidents", params: { view: card.view } })}
>

<Text style={styles.number}>
{card.count}
</Text>

<Text style={styles.label}>
{card.label}
</Text>

</TouchableOpacity>
))}

</View>

<View style={styles.headerRow}>

<Text style={styles.section}>
{S.dashboard.recent}
</Text>

<TouchableOpacity
onPress={()=>router.push("/incidents")}
>

<Text style={styles.view}>
{S.dashboard.viewAll}
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

<View style={styles.info}>

<Text style={styles.incidentId}>#{item.id}</Text>

<Text style={styles.incidentTitle}>

{item.hostname}

</Text>

<Text style={styles.server} numberOfLines={1}>

{item.srcIp ?? item.ruleDescription}

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
width:"31%",
paddingVertical:18,
paddingHorizontal:6,
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
marginTop:8,
textAlign:"center"
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

info:{
flex:1,
marginRight:12
},

incidentId:{
color:Colors.primary,
fontWeight:"700",
fontSize:13,
marginBottom:2
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
