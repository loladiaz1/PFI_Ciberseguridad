import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";

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
  backgroundColor:Colors.background,
  padding:20,
  paddingTop:60
},

title:{
  fontSize:30,
  fontWeight:"bold",
  marginBottom:20,
  color:Colors.text
},

card:{
  backgroundColor:Colors.card,
  padding:20,
  borderRadius:16,
  borderWidth:1,
  borderColor:Colors.border
},

statusRow:{
  flexDirection:"row",
  alignItems:"center",
  marginBottom:12
},

label:{
  color:Colors.textSecondary
},

value:{
  fontSize:18,
  fontWeight:"600",
  color:Colors.text
},

critical:{
  marginLeft:8,
  fontWeight:"bold",
  fontSize:22,
  color:Colors.danger
},

recommendation:{
  backgroundColor:Colors.card2,
  padding:20,
  borderRadius:16,
  marginTop:25,
  borderWidth:1,
  borderColor:Colors.warning
},

recTitle:{
  fontWeight:"bold",
  fontSize:18,
  marginBottom:10,
  color:Colors.warning
},

recText:{
  marginBottom:8,
  color:Colors.text
},

block:{
  marginTop:10,
  fontWeight:"bold",
  color:Colors.danger,
  fontSize:20
},

button:{
  marginTop:35,
  backgroundColor:Colors.danger,
  padding:18,
  borderRadius:14
},

buttonText:{
  textAlign:"center",
  color:Colors.text,
  fontWeight:"bold",
  fontSize:18
}});