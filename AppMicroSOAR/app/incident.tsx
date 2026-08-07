import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";
import MaterialIcons from "@expo/vector-icons/build/MaterialIcons";

export default function IncidentDetail() {

    return (

        <View style={styles.container}>
            <BrandLogo showText={false} />

            <Text style={styles.title}>
                SSH Brute Force
            </Text>

            <View style={styles.card}>

                <Text style={styles.label}>Severity</Text>
                <View style={styles.statusRow}>
                <MaterialIcons
                    name="error"
                    size={22}
                    color={Colors.danger}
                        />
                 <Text style={styles.critical}>CRITICAL</Text>
        </View>

                <Text style={styles.label}>Target</Text>
                <Text style={styles.value}>SERVER-02</Text>

                <Text style={styles.label}>Attacker IP</Text>
                <Text style={styles.value}>
                    185.220.101.55
                </Text>

                <Text style={styles.label}>Country</Text>
                <Text style={styles.value}>Russia</Text>

                <Text style={styles.label}>Attempts</Text>
                <Text style={styles.value}>346</Text>

            </View>

            <View style={styles.recommendation}>

                <Text style={styles.recTitle}>
                    Automatic Recommendation
                </Text>

                <Text style={styles.recText}>
                    This IP has a malicious reputation and
                    is attacking a critical asset.
                </Text>

                <Text style={styles.recText}>
                    Recommended action:
                </Text>

                <Text style={styles.block}>
                    BLOCK IP
                </Text>

            </View>

            <TouchableOpacity
                style={styles.button}
                onPress={() => router.push("/confirm")}
            >

                <Text style={styles.buttonText}>
                    BLOCK IP
                </Text>

            </TouchableOpacity>
            <BottomNav />

        </View>

    );

}

const styles = StyleSheet.create({

container:{
flex:1,
backgroundColor:"#F4F7FA",
padding:20,
paddingTop:60
},

title:{
fontSize:30,
fontWeight:"bold",
marginBottom:20
},

card:{
backgroundColor:"white",
padding:20,
borderRadius:16
},

label:{
marginTop:15,
color:"#777"
},

statusRow:{
flexDirection:"row",
alignItems:"center",
gap:8,
marginTop:8
},

value:{
fontSize:18,
fontWeight:"600"
},

critical:{
fontWeight:"bold",
fontSize:22,
color:"#E53935"
},

recommendation:{
backgroundColor:"#FFF4E5",
padding:20,
borderRadius:16,
marginTop:25
},

recTitle:{
fontWeight:"bold",
fontSize:18,
marginBottom:10
},

recText:{
marginBottom:8
},

block:{
marginTop:10,
fontWeight:"bold",
color:"#E53935",
fontSize:20
},

button:{
marginTop:35,
backgroundColor:"#D32F2F",
padding:18,
borderRadius:14
},

buttonText:{
textAlign:"center",
color:"white",
fontWeight:"bold",
fontSize:18
}

});