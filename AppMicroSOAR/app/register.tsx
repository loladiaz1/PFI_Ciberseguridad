import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { signUp } from '../services/auth';
import Colors from "../styles/colors";

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleRegister = async () => {
    await signUp(name, email, password);
    router.replace('/dashboard');
  };

  return (
    <View style={styles.container}>
      {/* Logo + nombre */}
      <View style={styles.logoSection}>
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.appName}>FORTIA</Text>
      </View>

      {/* Formulario */}
      <View style={styles.formSection}>
        <TextInput
          style={styles.input}
          placeholder="Name"
          placeholderTextColor={Colors.border}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={Colors.border}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={Colors.border}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Pressable style={styles.button} onPress={handleRegister}>
          <Text style={styles.buttonText}>REGISTER</Text>
        </Pressable>
      </View>

      {/* Mensaje inferior en naranja */}
      <Pressable style={styles.loginLinkWrapper} onPress={() => router.replace('/')}>
        <Text style={styles.loginLink}>Already have an account? Log in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  logoSection: {
    alignItems: 'center',
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
    fontWeight: '800',
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

  button: {
    backgroundColor: Colors.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },

  buttonText: {
    color: Colors.text,
    fontWeight: '700',
  },

  loginLinkWrapper: {
    paddingVertical: 20,
    alignItems: 'center',
  },

  loginLink: {
    color: '#FF8C00',
    fontWeight: '600',
    fontSize: 14,
  },
});