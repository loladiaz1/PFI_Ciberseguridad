import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image } from "react-native";
import { router } from "expo-router";
import { useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";


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
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.title}>FORTIA</Text>
      </View>

      <View style={styles.formSection}>
        <TextInput
          placeholder="example@company.com"
          placeholderTextColor={Colors.border}
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          placeholder="Password"
          placeholderTextColor={Colors.border}
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={styles.loginButton} onPress={login}>
          <Text style={styles.loginText}>LOGIN</Text>
        </TouchableOpacity>
      </View>

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
    backgroundColor:Colors.background
  },

  logo:{
    alignItems:"center",
    paddingTop:60,
    paddingBottom:12
  },

  logoImage:{
    width:140,
    height:140
  },

  title:{
    fontSize:26,
    fontWeight:"800",
    color:Colors.primary,
    marginTop:8,
    letterSpacing:1
  },

  formSection:{
    paddingHorizontal:24
  },

  input:{
    borderWidth:1,
    borderColor:Colors.border,
    borderRadius:10,
    padding:12,
    marginBottom:12,
    backgroundColor:Colors.card,
    color:Colors.text
  },

  loginButton:{
    backgroundColor:Colors.primary,
    padding:14,
    borderRadius:10,
    alignItems:"center",
    marginTop:4
  },

  loginText:{
    color:Colors.text,
    fontWeight:"700",
    fontSize:16
  },

  register:{
    textAlign:"center",
    paddingVertical:20,
    color:Colors.primary
  }

});