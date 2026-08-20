import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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

export interface RegistrationData {
  fullName: string;
  email: string;
  phoneNumber: string;
  emergencyContact: string;
  vehicleModel: string;
  plateNumber: string;
  vehicleColor: string;
  password: string;
}

interface RegistrationGateScreenProps {
  initialData?: Partial<RegistrationData>;
  apiBaseUrl: string;
  isOnline?: boolean;
  onCancel?: () => void;
  onCompleteRegistration: (data: RegistrationData) => void;
}

export function RegistrationGateScreen({
  initialData,
  apiBaseUrl,
  isOnline,
  onCancel,
  onCompleteRegistration,
}: RegistrationGateScreenProps) {
  const [fullName, setFullName] = useState(initialData?.fullName || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [phoneNumber, setPhoneNumber] = useState(initialData?.phoneNumber || '');
  const [emergencyContact, setEmergencyContact] = useState(initialData?.emergencyContact || '');
  const [vehicleModel, setVehicleModel] = useState(initialData?.vehicleModel || '');
  const [plateNumber, setPlateNumber] = useState(initialData?.plateNumber || '');
  const [vehicleColor, setVehicleColor] = useState(initialData?.vehicleColor || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Normalize a 10-digit Nepali mobile number to E.164 (+977XXXXXXXXXX). */
  const normalizeNepaliPhone = (raw: string): string => {
    const digits = raw.replace(/\s|-/g, '');
    return /^9\d{9}$/.test(digits) ? `+977${digits}` : raw.trim();
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    }
    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Invalid email format (e.g. rider@example.com)';
    }
    if (!phoneNumber.trim() || phoneNumber.trim().length < 7) {
      newErrors.phoneNumber = 'Enter a valid phone number (e.g. 9812345678 or +9779812345678)';
    } else if (!/^\+[1-9]\d{1,14}$/.test(normalizeNepaliPhone(phoneNumber))) {
      newErrors.phoneNumber = 'Invalid phone number. Use your 10-digit number or full E.164 format';
    }
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters long';
    } else if (!/[A-Z]/.test(password)) {
      newErrors.password = 'Password must contain at least one uppercase letter (A-Z)';
    } else if (!/[a-z]/.test(password)) {
      newErrors.password = 'Password must contain at least one lowercase letter (a-z)';
    } else if (!/[0-9]/.test(password)) {
      newErrors.password = 'Password must contain at least one number (0-9)';
    }
    if (!emergencyContact.trim()) {
      newErrors.emergencyContact = 'Emergency contact name & phone is required';
    }
    if (!vehicleModel.trim()) {
      newErrors.vehicleModel = 'Vehicle make & model is required';
    }
    if (!plateNumber.trim()) {
      newErrors.plateNumber = 'License plate number is required';
    }
    if (!vehicleColor.trim()) {
      newErrors.vehicleColor = 'Vehicle color is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (validate()) {
      setIsSubmitting(true);
      setErrors({});
      const data: RegistrationData = {
        fullName: fullName.trim(),
        email: email.toLowerCase().trim(),
        phoneNumber: normalizeNepaliPhone(phoneNumber.trim()),
        emergencyContact: emergencyContact.trim(),
        vehicleModel: vehicleModel.trim(),
        plateNumber: plateNumber.trim(),
        vehicleColor: vehicleColor.trim(),
        password,
      };
      try {
        const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.fullName,
          email: data.email,
          password: data.password,
          phone: data.phoneNumber,
          vehicle_model: data.vehicleModel,
          plate_number: data.plateNumber,
          vehicle_color: data.vehicleColor,
        }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Registration failed');
        onCompleteRegistration(data);
      } catch (error) {
        setErrors({ submit: error instanceof Error ? error.message : 'Registration failed. Check network or server connection.' });
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.badgeRow}>
            <Text style={styles.gateBadge}>🔒 ONE-TIME RIDER GATE</Text>
            <Text style={styles.stepTag}>STEP 1 OF 1</Text>
          </View>
          <Text style={styles.title}>Rider Registration</Text>
          <Text style={styles.subtitle}>
            Please set up your rider identity and vehicle details before creating or joining group rides.
          </Text>
        </View>

        {/* SECTION 1: PERSONAL & EMERGENCY DETAILS */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>👤 Personal & Emergency Info</Text>
          
          <Text style={styles.fieldLabel}>FULL RIDER NAME *</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="e.g. Alex Vance"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.fullName ? styles.inputError : null]}
            autoCapitalize="words"
          />
          {errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}

          <Text style={styles.fieldLabel}>EMAIL ADDRESS *</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="e.g. rider@gmail.com"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.email ? styles.inputError : null]}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

          <Text style={styles.fieldLabel}>PHONE NUMBER *</Text>
          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="e.g. 9812345678 or +9779812345678"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.phoneNumber ? styles.inputError : null]}
            keyboardType="phone-pad"
          />
          {errors.phoneNumber ? <Text style={styles.errorText}>{errors.phoneNumber}</Text> : null}

          <Text style={styles.fieldLabel}>PASSWORD *</Text>
          <View style={styles.passwordInputContainer}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters, upper/lowercase and a number"
              placeholderTextColor="#5C7062"
              style={[styles.passwordInput, errors.password ? styles.inputError : null]}
              secureTextEntry={!showPassword}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
              <Text style={styles.eyeButtonText}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </Pressable>
          </View>
          {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

          <Text style={styles.fieldLabel}>EMERGENCY CONTACT NAME & PHONE *</Text>
          <TextInput
            value={emergencyContact}
            onChangeText={setEmergencyContact}
            placeholder="e.g. Sarah Vance (Sister) +1-555-0199"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.emergencyContact ? styles.inputError : null]}
            keyboardType="phone-pad"
          />
          {errors.emergencyContact ? <Text style={styles.errorText}>{errors.emergencyContact}</Text> : null}
        </View>

        {/* SECTION 2: VEHICLE DETAILS */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>🏍️ Vehicle Identification</Text>
          <Text style={styles.cardCopy}>
            Used in ride member rosters so your group can identify your bike on the road.
          </Text>

          <Text style={styles.fieldLabel}>VEHICLE MAKE & MODEL *</Text>
          <TextInput
            value={vehicleModel}
            onChangeText={setVehicleModel}
            placeholder="e.g. Royal Enfield Himalayan 450"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.vehicleModel ? styles.inputError : null]}
          />
          {errors.vehicleModel ? <Text style={styles.errorText}>{errors.vehicleModel}</Text> : null}

          <Text style={styles.fieldLabel}>LICENSE PLATE NUMBER *</Text>
          <TextInput
            value={plateNumber}
            onChangeText={setPlateNumber}
            placeholder="e.g. BA 2 PA 1234"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.plateNumber ? styles.inputError : null]}
            autoCapitalize="characters"
          />
          {errors.plateNumber ? <Text style={styles.errorText}>{errors.plateNumber}</Text> : null}

          <Text style={styles.fieldLabel}>VEHICLE COLOR *</Text>
          <TextInput
            value={vehicleColor}
            onChangeText={setVehicleColor}
            placeholder="e.g. Pine Green / Black"
            placeholderTextColor="#5C7062"
            style={[styles.input, errors.vehicleColor ? styles.inputError : null]}
          />
          {errors.vehicleColor ? <Text style={styles.errorText}>{errors.vehicleColor}</Text> : null}
        </View>

        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerText}>
            💡 Medical details (blood group, allergies) can be added later in settings and remain strictly private during normal riding.
          </Text>
        </View>
        {errors.submit ? (
          <View style={styles.submitErrorBanner}>
            <Text style={styles.submitErrorText}>⚠️ {errors.submit}</Text>
          </View>
        ) : null}

        {/* SUBMIT BUTTON */}
        <Pressable
          onPress={handleSubmit}
          disabled={isSubmitting}
          style={[styles.submitBtn, isSubmitting ? styles.submitBtnDisabled : null]}
        >
          <Text style={styles.submitBtnText}>
            {isSubmitting ? 'Registering...' : 'Complete Registration & Continue →'}
          </Text>
        </Pressable>

        {onCancel ? (
          <Pressable onPress={onCancel} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Already have an account? Sign in</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink },
  scrollContent: { padding: 20, gap: 16 },
  header: { marginBottom: 4 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  gateBadge: {
    color: COLORS.amber,
    backgroundColor: '#382606',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  stepTag: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800' },
  subtitle: { color: COLORS.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  cardSectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  cardCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 16, marginBottom: 4 },
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
  infoBanner: {
    backgroundColor: '#102A1A',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  infoBannerText: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
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
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  cancelBtn: { alignSelf: 'center', paddingVertical: 12, marginBottom: 24 },
  cancelBtnText: { color: COLORS.blue, fontSize: 13, fontWeight: '700' },
});

export default RegistrationGateScreen;
