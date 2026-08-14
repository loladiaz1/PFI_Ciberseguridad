import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useState } from "react";
import Colors from "../styles/colors";
import BottomNav from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";
import { signIn } from "../services/auth";

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setError("");
    setLoading(true);
    try {
      await signIn(username, password);
      router.replace("/dashboard");
    } catch {
      setError("Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>

      <View style={styles.logo}>
        <BrandLogo showText={true} />
        <Text style={styles.subtitle}>Security Operations Center</Text>
      </View>

      <Text style={styles.label}>Username</Text>

      <TextInput
        placeholder="analyst"
        placeholderTextColor="#888"
        autoCapitalize="none"
        style={styles.input}
        value={username}
        onChangeText={setUsername}
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.loginButton} onPress={login} disabled={loading}>
        <Text style={styles.loginText}>{loading ? "SIGNING IN..." : "LOGIN"}</Text>
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
  },

  error:{
    color:Colors.danger,
    marginTop:-8,
    marginBottom:12
  }

});