import { useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { signUp } from "../services/auth";
import Colors from "../styles/colors";

export default function RegisterScreen() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ======================================
  // VALIDACIONES
  // ======================================

  const nameValid = name.trim().length >= 2;

  const emailValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const passwordHasLength =
    password.length >= 9;

  const passwordHasUppercase =
    /[A-Z]/.test(password);

  const passwordHasLowercase =
    /[a-z]/.test(password);

  const passwordHasNumber =
    /[0-9]/.test(password);

  const passwordHasSpecial =
    /[^A-Za-z0-9]/.test(password);

  const passwordValid =
    passwordHasLength &&
    passwordHasUppercase &&
    passwordHasLowercase &&
    passwordHasNumber &&
    passwordHasSpecial;

  const formValid =
    nameValid &&
    emailValid &&
    passwordValid;

  const hasStartedTyping =
    name.length > 0 ||
    email.length > 0 ||
    password.length > 0;

  // ======================================
  // REGISTER
  // ======================================

  const handleRegister = async () => {

    // --------------------------------------
    // VALIDACIONES DEL FRONTEND
    // --------------------------------------

    if (!name || !email || !password) {
      Alert.alert(
        "Incomplete fields",
        "Please complete all fields."
      );
      return;
    }

    if (!nameValid) {
      Alert.alert(
        "Invalid name",
        "Your name must contain at least 2 characters."
      );
      return;
    }

    if (!emailValid) {
      Alert.alert(
        "Invalid email",
        "Please enter a valid email address."
      );
      return;
    }

    if (!passwordValid) {
      Alert.alert(
        "Weak password",
        "Your password must contain at least 9 characters, one uppercase letter, one lowercase letter, one number and one special character."
      );
      return;
    }

    // --------------------------------------
    // BACKEND
    // --------------------------------------

    try {
      setLoading(true);

      const result = await signUp(
        name.trim(),
        email.trim().toLowerCase(),
        password
      );

      console.log(
        "Usuario registrado:",
        result.user
      );

      // --------------------------------------
      // REGISTRO CORRECTO
      // --------------------------------------
      // El registro es mock (no hay endpoint real todavia), asi que no
      // guarda una sesion valida -- mandar a /dashboard aca terminaba
      // rebotando solo al login en cuanto cualquier pantalla pedia datos
      // autenticados. Mandamos al login de una, con el mensaje correcto.

      Alert.alert(
        "Account created",
        "Please log in with your new account."
      );

      router.replace("/");

    } catch (error) {

      console.log(
        "Register request handled:",
        error
      );

      // --------------------------------------
      // ERROR CONTROLADO
      // --------------------------------------

      let message =
        "Unable to create the account.";

      if (error instanceof Error) {
        message = error.message;
      }

      Alert.alert(
        "Registration failed",
        message
      );

    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>

      {/* ================================== */}
      {/* LOGO */}
      {/* ================================== */}

      <View style={styles.logoSection}>

        <Image
          source={require("../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.appName}>
          FORTIA
        </Text>

      </View>

      {/* ================================== */}
      {/* FORMULARIO */}
      {/* ================================== */}

      <View style={styles.formSection}>

        {/* NAME */}

        <TextInput
          style={styles.input}
          placeholder="Name"
          placeholderTextColor={Colors.border}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        {/* EMAIL */}

        <TextInput
          style={styles.input}
          placeholder="example@company.com"
          placeholderTextColor={Colors.border}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        {/* PASSWORD */}

        <View style={styles.passwordContainer}>

          <TextInput
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor={Colors.border}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Pressable
            style={styles.eyeButton}
            onPress={() =>
              setShowPassword((previous) => !previous)
            }
            hitSlop={10}
          >

            <Ionicons
              name={
                showPassword
                  ? "eye-outline"
                  : "eye-off-outline"
              }
              size={22}
              color={Colors.border}
            />

          </Pressable>

        </View>

        {/* ================================== */}
        {/* VALIDACIONES */}
        {/* ================================== */}

        {hasStartedTyping && (
          <View style={styles.validationBox}>

            <ValidationRow
              text="Name has at least 2 characters"
              valid={nameValid}
              visible={name.length > 0}
            />

            <ValidationRow
              text="Valid email address"
              valid={emailValid}
              visible={email.length > 0}
            />

            <ValidationRow
              text="At least 9 characters"
              valid={passwordHasLength}
              visible={password.length > 0}
            />

            <ValidationRow
              text="At least one uppercase letter"
              valid={passwordHasUppercase}
              visible={password.length > 0}
            />

            <ValidationRow
              text="At least one lowercase letter"
              valid={passwordHasLowercase}
              visible={password.length > 0}
            />

            <ValidationRow
              text="At least one number"
              valid={passwordHasNumber}
              visible={password.length > 0}
            />

            <ValidationRow
              text="At least one special character"
              valid={passwordHasSpecial}
              visible={password.length > 0}
            />

          </View>
        )}

        {/* ================================== */}
        {/* REGISTER */}
        {/* ================================== */}

        <Pressable
          style={[
            styles.button,
            !formValid && styles.buttonDisabled,
          ]}
          onPress={handleRegister}
          disabled={loading}
        >

          <Text style={styles.buttonText}>
            {loading
              ? "CREATING ACCOUNT..."
              : "REGISTER"}
          </Text>

        </Pressable>

      </View>

      {/* ================================== */}
      {/* LOGIN */}
      {/* ================================== */}

      <Pressable
        style={styles.loginLinkWrapper}
        onPress={() => router.replace("/")}
      >

        <Text style={styles.loginLink}>
          Already have an account? Log in
        </Text>

      </Pressable>

    </View>
  );
}


// ======================================
// VALIDATION ROW
// ======================================

type ValidationRowProps = {
  text: string;
  valid: boolean;
  visible: boolean;
};

function ValidationRow({
  text,
  valid,
  visible,
}: ValidationRowProps) {

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.validationRow}>

      <View
        style={[
          styles.validationIcon,
          valid
            ? styles.validationSuccess
            : styles.validationError,
        ]}
      >

        <Text style={styles.validationIconText}>
          {valid ? "✓" : "×"}
        </Text>

      </View>

      <Text
        style={[
          styles.validationText,
          valid
            ? styles.validationTextSuccess
            : styles.validationTextError,
        ]}
      >
        {text}
      </Text>

    </View>
  );
}


// ======================================
// STYLES
// ======================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  logoSection: {
    alignItems: "center",
    paddingTop: 60,
    paddingBottom: 12,
  },

  logo: {
    width: 140,
    height: 140,
  },

  appName: {
    marginTop: 8,
    fontSize: 26,
    fontWeight: "800",
    color: Colors.primary,
    letterSpacing: 1,
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

  // ======================================
  // PASSWORD
  // ======================================

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

  // ======================================
  // VALIDACIONES
  // ======================================

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

  // ======================================
  // BUTTON
  // ======================================

  button: {
    backgroundColor: Colors.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },

  buttonDisabled: {
    opacity: 0.65,
  },

  buttonText: {
    color: Colors.text,
    fontWeight: "700",
  },

  // ======================================
  // LOGIN LINK
  // ======================================

  loginLinkWrapper: {
    paddingVertical: 20,
    alignItems: "center",
  },

  loginLink: {
    color: "#FF8C00",
    fontWeight: "600",
    fontSize: 14,
  },

});
