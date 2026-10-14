import { Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

// Step-up biometrico para acciones privilegiadas (gestion de usuarios, y a
// futuro la configuracion de la automatizacion). La validacion la hace el
// sistema operativo: la app solo recibe aprobado / rechazado, nunca datos
// biometricos.
export async function confirmWithBiometrics(promptMessage: string): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (!hasHardware || !isEnrolled) {
    Alert.alert(
      'Biometrics required',
      'No biometrics enrolled on this device. Set up Face ID / Fingerprint to continue.'
    );
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({ promptMessage });
  return result.success;
}
