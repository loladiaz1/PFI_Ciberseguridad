import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";


export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = () => {
    // Después reemplazamos esto por axios al backend
    router.push("/dashboard");
  };

  return (
    <View style={styles.container}>

      <View style={styles.logo}>
        <BrandLogo showText={true} />
        <Text style={styles.subtitle}>Security Operations Center</Text>
      </View>

      <Text style={styles.label}>Email</Text>

      <TextInput
        placeholder="example@company.com"
        placeholderTextColor="#888"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />

      <Text style={styles.label}>Password</Text>

      <TextInput
        placeholder="********"
        placeholderTextColor="#888"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.loginButton} onPress={login}>
        <Text style={styles.loginText}>LOGIN</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/register")}>
        <Text style={styles.register}>
          Don't have an account? Register
        </Text>
      </TouchableOpacity>

    </View>
  );
}



const styles = StyleSheet.create({

  container:{
    flex:1,
    backgroundColor:Colors.background,
    justifyContent:"center",
    padding:30
  },

  logo:{
    alignItems:"center",
    marginBottom:60
  },

  logoIcon:{
    fontSize:60
  },

  title:{
    fontSize:34,
    fontWeight:"bold",
    color:Colors.text,
    marginTop:10
  },

  subtitle:{
    color:Colors.textSecondary,
    marginTop:6
  },

  label:{
    fontWeight:"600",
    marginBottom:8,
    color:Colors.text
  },

  input:{
    backgroundColor:Colors.card,
    color:Colors.text,
    borderRadius:12,
    padding:15,
    marginBottom:20,
    borderWidth:1,
    borderColor:Colors.border
  },

  loginButton:{
    backgroundColor:Colors.primary,
    padding:16,
    borderRadius:12,
    alignItems:"center",
    marginTop:10
  },

  loginText:{
    color:Colors.text,
    fontWeight:"bold",
    fontSize:16
  },

  register:{
    textAlign:"center",
    marginTop:25,
    color:Colors.primary
  }

});