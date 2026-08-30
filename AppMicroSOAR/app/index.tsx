import { View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, Image } from "react-native";
import { router } from "expo-router";
import { useState } from "react";
import { isAxiosError } from "axios";
import Colors from "../styles/colors";
import { signIn } from "../services/auth";

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const usernameValid = username.trim().length > 0;
  const passwordValid = password.length > 0;
  const hasStartedTyping = username.length > 0 || password.length > 0;
  const loginFormValid = usernameValid && passwordValid;

  const login = async () => {
    setError("");
    setLoading(true);
    try {
      await signIn(username.trim(), password);
      router.replace("/dashboard");
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (isAxiosError(err) && err.response?.status === 401) {
        setError("Invalid credentials");
      } else {
        setError("Unable to connect to the server");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>

      {/* LOGO */}

      <View style={styles.logo}>
        <Image
          source={require("../assets/images/logo.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.title}>FORTIA</Text>
        <Text style={styles.subtitle}>Security Operations Center</Text>
      </View>

      {/* FORMULARIO */}

      <View style={styles.formSection}>

        <TextInput
          placeholder="Username"
          placeholderTextColor={Colors.border}
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />

        <View style={styles.passwordContainer}>
          <TextInput
            placeholder="Password"
            placeholderTextColor={Colors.border}
            secureTextEntry={!showPassword}
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
          />
          <Pressable style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
            <Text style={styles.eyeIcon}>{showPassword ? "◉" : "◌"}</Text>
          </Pressable>
        </View>

        {hasStartedTyping && (
          <View style={styles.validationBox}>
            <ValidationRow text="Username entered" valid={usernameValid} visible={username.length > 0} />
            <ValidationRow text="Password entered" valid={passwordValid} visible={password.length > 0} />
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.loginButton, !loginFormValid && styles.loginButtonDisabled]}
          onPress={login}
          disabled={loading}
        >
          <Text style={styles.loginText}>{loading ? "LOGGING IN..." : "LOGIN"}</Text>
        </TouchableOpacity>

      </View>

      <TouchableOpacity onPress={() => router.push("/register")}>
        <Text style={styles.register}>
          Don&apos;t have an account? Register
        </Text>
      </TouchableOpacity>

    </View>
  );
}

type ValidationRowProps = {
  text: string;
  valid: boolean;
  visible: boolean;
};

function ValidationRow({ text, valid, visible }: ValidationRowProps) {
  if (!visible) return null;

  return (
    <View style={styles.validationRow}>
      <View style={[styles.validationIcon, valid ? styles.validationSuccess : styles.validationError]}>
        <Text style={styles.validationIconText}>{valid ? "✓" : "×"}</Text>
      </View>
      <Text style={[styles.validationText, valid ? styles.validationTextSuccess : styles.validationTextError]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
  },

  logo: {
    alignItems: "center",
    paddingBottom: 40,
  },

  logoImage: {
    width: 140,
    height: 140,
  },

  title: {
    fontSize: 26,
    fontWeight: "800",
    color: Colors.primary,
    marginTop: 8,
    letterSpacing: 1,
  },

  subtitle: {
    color: Colors.textSecondary,
    marginTop: 6,
  },

  formSection: {
    paddingHorizontal: 24,
  },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: Colors.card,
    color: Colors.text,
  },

  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    marginBottom: 12,
    backgroundColor: Colors.card,
  },

  passwordInput: {
    flex: 1,
    padding: 12,
    color: Colors.text,
  },

  eyeButton: {
    width: 45,
    height: 45,
    justifyContent: "center",
    alignItems: "center",
  },

  eyeIcon: {
    fontSize: 20,
    color: Colors.border,
  },

  validationBox: {
    backgroundColor: "#2A2A2A",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#3A3A3A",
  },

  validationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 2,
  },

  validationIcon: {
    width: 15,
    height: 15,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 7,
  },

  validationSuccess: {
    backgroundColor: "#32CD65",
  },

  validationError: {
    backgroundColor: "#E74C3C",
  },

  validationIconText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 14,
  },

  validationText: {
    fontSize: 11,
    fontWeight: "500",
  },

  validationTextSuccess: {
    color: "#7EE69A",
  },

  validationTextError: {
    color: "#FF8A80",
  },

  loginButton: {
    backgroundColor: Colors.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },

  loginButtonDisabled: {
    opacity: 0.65,
  },

  loginText: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 16,
  },

  register: {
    textAlign: "center",
    paddingVertical: 20,
    color: Colors.primary,
  },

  error: {
    color: Colors.danger,
    textAlign: "center",
    marginBottom: 10,
  },

});
