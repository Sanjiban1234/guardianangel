import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import * as SecureStore from './utils/SecureStore';

const COLORS = {
  forest: '#14532D',
  blue: '#2F80ED',
  amber: '#F59E0B',
  red: '#DC2626',
  green: '#16A34A',
  ink: '#0B130E',
  card: '#142318',
  line: '#1E3A28',
  text: '#F0FDF4',
  muted: '#A3B8A8',
  darkInput: '#0F1A12',
};

interface LoginScreenProps {
  apiBaseUrl: string;
  onLoginSuccess: (token: string, userData: { id: string; name: string; email: string; profile_complete: boolean }) => void;
  onNavigateToRegister: () => void;
}

export function LoginScreen({ apiBaseUrl, onLoginSuccess, onNavigateToRegister }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('');
  const [biometricSetupReady, setBiometricSetupReady] = useState(false);

  useEffect(() => {
    checkBiometricAvailability();
  }, []);

  const checkBiometricAvailability = async () => {
    try {
      const rnBiometrics = new ReactNativeBiometrics();
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();

      if (available) {
        setBiometricAvailable(true);
        if (biometryType === BiometryTypes.TouchID) {
          setBiometricType('Touch ID');
        } else if (biometryType === BiometryTypes.FaceID) {
          setBiometricType('Face ID');
        } else if (biometryType === BiometryTypes.Biometrics) {
          setBiometricType('Biometrics');
        }

        const credential = await SecureStore.loadBiometricCredential();
        const { keysExist } = await rnBiometrics.biometricKeysExist();
        setBiometricSetupReady(Boolean(credential && keysExist));
        if (credential && !keysExist) await SecureStore.clearBiometricLogin();
      }
    } catch {
      setBiometricAvailable(false);
      setBiometricSetupReady(false);
    }
  };

  const handleBiometricLogin = async () => {
    try {
      const credential = await SecureStore.loadBiometricCredential();
      const rnBiometrics = new ReactNativeBiometrics();
      const { keysExist } = await rnBiometrics.biometricKeysExist();
      if (!credential || !keysExist) {
        await SecureStore.clearBiometricLogin();
        setBiometricSetupReady(false);
        Alert.alert(
          'Biometric Login Unavailable',
          'Biometric login is not set up. Please log in with your email and password first, then enable biometric login.',
          [{ text: 'OK' }],
        );
        return;
      }

      setIsSubmitting(true);
      const challengeResponse = await fetch(`${apiBaseUrl}/api/auth/biometric/challenge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: credential.credentialId }),
      });
      if (!challengeResponse.ok) {
        await SecureStore.clearBiometricLogin();
        setBiometricSetupReady(false);
        Alert.alert(
          'Biometric Data Expired',
          'Your biometric credentials have been cleared. Please log in with your password to re-enable biometric login.',
          [{ text: 'OK' }],
        );
        return;
      }
      const challengeBody = await challengeResponse.json();
      if (typeof challengeBody?.challenge !== 'string') throw new Error('Biometric login failed');
      const signatureResult = await rnBiometrics.createSignature({
        promptMessage: 'Login with biometrics', payload: challengeBody.challenge,
      });
      if (!signatureResult.success || !signatureResult.signature) return;
      const verifyResponse = await fetch(`${apiBaseUrl}/api/auth/biometric/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: credential.credentialId, challenge: challengeBody.challenge, signature: signatureResult.signature }),
      });
      const body = await verifyResponse.json();
      if (!verifyResponse.ok) {
        await SecureStore.clearBiometricLogin();
        setBiometricSetupReady(false);
        Alert.alert('Biometric Login Unavailable', 'Please sign in with your password and enable biometric login again.');
        return;
      }
      onLoginSuccess(body.token, body.user);
    } catch {
      Alert.alert(
        'Authentication Failed',
        'Unable to authenticate with biometrics. Please try again or use your password.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const performLogin = async (
    loginEmail: string,
    loginPassword: string,
  ) => {
    setIsSubmitting(true);
    setErrors({});

    try {
      const loginUrl = `${apiBaseUrl}/api/auth/login`;
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.toLowerCase().trim(), password: loginPassword }),
      });

      const body = await response.json();

      if (!response.ok) throw new Error(body.error || 'Login failed');

      // Normal login succeeded — offer biometric setup if available and not already set up
      if (biometricAvailable && !biometricSetupReady) {
        Alert.alert(
          'Enable Biometric Login?',
          `Would you like to enable ${biometricType} for faster login next time?`,
          [
            {
              text: 'Not Now',
              style: 'cancel',
              onPress: () => onLoginSuccess(body.token, body.user),
            },
            {
              text: 'Enable',
              onPress: async () => {
                const enabled = await enableBiometricLogin(body.token);
                if (enabled) {
                  setBiometricSetupReady(true);
                  Alert.alert(
                    'Biometric Login Enabled',
                    `${biometricType} login has been set up. You can use it next time you sign in.`,
                    [{ text: 'OK', onPress: () => onLoginSuccess(body.token, body.user) }],
                  );
                } else {
                  Alert.alert(
                    'Setup Failed',
                    'Unable to set up biometric login. You can try again next time.',
                    [{ text: 'OK', onPress: () => onLoginSuccess(body.token, body.user) }],
                  );
                }
              },
            },
          ],
        );
      } else {
        onLoginSuccess(body.token, body.user);
      }
    } catch (error) {
      setErrors({
        submit: error instanceof Error ? error.message : 'Login failed. Check your credentials or connection.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const enableBiometricLogin = async (token: string): Promise<boolean> => {
    try {
      const rnBiometrics = new ReactNativeBiometrics();
      const existing = await rnBiometrics.biometricKeysExist();
      if (existing.keysExist) await rnBiometrics.deleteKeys();
      const { publicKey } = await rnBiometrics.createKeys();
      const response = await fetch(`${apiBaseUrl}/api/auth/biometric/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_key: publicKey }),
      });
      const body = await response.json();
      if (!response.ok || typeof body?.credential_id !== 'string') {
        await rnBiometrics.deleteKeys();
        return false;
      }
      await SecureStore.saveBiometricCredential({ credentialId: body.credential_id });
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Invalid email format';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    await performLogin(email, password);
  };

  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>🏍️ Guardian Angel</Text>
          <Text style={styles.subtitle}>Sign in to your rider account</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>EMAIL ADDRESS *</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="e.g. rider@gmail.com"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.email ? styles.inputError : null]}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!isSubmitting}
          />
          {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

          <Text style={styles.fieldLabel}>PASSWORD *</Text>
          <View style={styles.passwordInputContainer}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor="#5C7062"
              style={[styles.passwordInput, errors.password ? styles.inputError : null]}
              secureTextEntry={!showPassword}
              editable={!isSubmitting}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
              <Text style={styles.eyeButtonText}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </Pressable>
          </View>
          {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
        </View>

        {errors.submit ? (
          <View style={styles.submitErrorBanner}>
            <Text style={styles.submitErrorText}>⚠️ {errors.submit}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleSubmit}
          disabled={isSubmitting}
          style={[styles.submitBtn, isSubmitting ? styles.submitBtnDisabled : null]}
        >
          <Text style={styles.submitBtnText}>
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </Text>
        </Pressable>

        {biometricAvailable && biometricSetupReady && (
          <View style={styles.biometricSection}>
            <View style={styles.biometricDivider}>
              <View style={styles.biometricDividerLine} />
              <Text style={styles.biometricDividerText}>OR</Text>
              <View style={styles.biometricDividerLine} />
            </View>
            <Pressable
              onPress={handleBiometricLogin}
              disabled={isSubmitting}
              style={[styles.biometricBtn, isSubmitting ? styles.submitBtnDisabled : null]}
            >
              <Text style={styles.biometricIcon}>🔒</Text>
              <View style={styles.biometricLabelGroup}>
                <Text style={styles.biometricBtnLabel}>
                  Login with {biometricType}
                </Text>
              </View>
            </Pressable>
          </View>
        )}

        <Pressable onPress={onNavigateToRegister} style={styles.registerBtn}>
          <Text style={styles.registerBtnText}>Don't have an account? Register</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink },
  scrollContent: { padding: 20, gap: 16, justifyContent: 'center', minHeight: '100%' },
  header: { marginBottom: 16, alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 32, fontWeight: '900', marginBottom: 8 },
  subtitle: { color: COLORS.muted, fontSize: 14 },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 6 },
  input: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
  },
  passwordInputContainer: {
    position: 'relative',
  },
  passwordInput: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingRight: 50,
    height: 48,
    fontSize: 14,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 12,
    padding: 4,
  },
  eyeButtonText: {
    fontSize: 20,
  },
  inputError: { borderColor: COLORS.red, borderWidth: 1.5 },
  errorText: { color: COLORS.red, fontSize: 11, fontWeight: '600', marginTop: 2 },
  submitErrorBanner: {
    backgroundColor: '#3B0A0A',
    borderColor: COLORS.red,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  submitErrorText: { color: '#FCA5A5', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  submitBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  biometricSection: { gap: 12, marginTop: 4 },
  biometricDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  biometricDividerLine: { flex: 1, height: 1, backgroundColor: COLORS.line },
  biometricDividerText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  biometricIcon: { fontSize: 22 },
  biometricLabelGroup: { flex: 1 },
  biometricBtnLabel: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  biometricBtnEmail: { color: COLORS.muted, fontSize: 11, marginTop: 1 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  registerBtn: { alignSelf: 'center', paddingVertical: 12 },
  registerBtnText: { color: COLORS.blue, fontSize: 13, fontWeight: '700' },
});

export default LoginScreen;
