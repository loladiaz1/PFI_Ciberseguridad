import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";


export default function ConfirmScreen() {
  return (
    <View style={styles.container}>
      <BrandLogo showText={false} />
      <Text style={styles.icon}>⚠️</Text>

      <Text style={styles.title}>
        Confirm Action
      </Text>

      <Text style={styles.subtitle}>
        You are about to block the following IP
      </Text>

      <View style={styles.card}>

        <Text style={styles.label}>Attacker IP</Text>
        <Text style={styles.value}>185.220.101.55</Text>

        <Text style={styles.label}>Target</Text>
        <Text style={styles.value}>SERVER-02</Text>

        <Text style={styles.label}>Severity</Text>
        <Text style={styles.critical}>CRITICAL</Text>

      </View>

      <Text style={styles.warning}>
        This action will update the firewall rules and block the attacker.
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push("/loading")}
      >
        <Text style={styles.buttonText}>
          BLOCK IP
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.back()}
      >
        <Text style={styles.cancel}>
          Cancel
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

  icon:{
    fontSize:60,
    textAlign:"center",
    marginBottom:20
  },

  title:{
    color:Colors.text,
    fontSize:30,
    fontWeight:"bold",
    textAlign:"center"
  },

  subtitle:{
    color:Colors.textSecondary,
    textAlign:"center",
    marginTop:15,
    marginBottom:30
  },

  card:{
    backgroundColor:Colors.card,
    borderRadius:18,
    padding:20,
    borderWidth:1,
    borderColor:Colors.border
  },

  label:{
    color:Colors.textSecondary,
    marginTop:15,
    fontSize:13
  },

  value:{
    color:Colors.text,
    fontSize:19,
    fontWeight:"600",
    marginTop:5
  },

  critical:{
    color:Colors.danger,
    fontSize:18,
    fontWeight:"bold",
    marginTop:5
  },

  warning:{
    color:Colors.textSecondary,
    textAlign:"center",
    marginTop:30,
    lineHeight:22
  },

  button:{
    marginTop:35,
    backgroundColor:Colors.primary,
    padding:18,
    borderRadius:15
  },

  buttonText:{
    color:"#fff",
    textAlign:"center",
    fontWeight:"bold",
    fontSize:17
  },

  cancel:{
    color:Colors.textSecondary,
    textAlign:"center",
    marginTop:18,
    fontSize:16
  }

});