# Android Development Environment Setup

Complete guide for setting up Android development on Windows for the Guardian Angel mobile app.

## Prerequisites

- Windows 10 or 11
- At least 8GB RAM (16GB recommended)
- 20GB free disk space for Android SDK
- Administrator access for installing software

## Step 1: Install Java Development Kit (JDK)

React Native requires JDK 17.

### Download and Install

1. Visit [Adoptium Temurin Downloads](https://adoptium.net/temurin/releases/?version=17)
2. Download **Windows x64 JDK .msi installer** (version 17.x.x)
3. Run the installer
4. During installation:
   - Check **"Set JAVA_HOME variable"**
   - Check **"Add to PATH"**
   - Complete the installation

### Verify Installation

Open a new PowerShell window:
```powershell
java -version
```

Expected output:
```
openjdk version "17.x.x"
OpenJDK Runtime Environment Temurin-17.x.x
```

## Step 2: Install Android Studio

### Download and Install

1. Visit [Android Studio Download Page](https://developer.android.com/studio)
2. Download the latest stable version
3. Run the installer (`android-studio-xxxx.exe`)
4. Choose **"Standard"** installation type
5. Let the wizard download and install:
   - Android SDK
   - Android SDK Platform
   - Android Virtual Device (AVD)
   - Performance components (Intel HAXM or Hypervisor)

**Note:** This download may take 30-60 minutes depending on your connection.

### First Launch Setup

1. Launch Android Studio
2. On the welcome screen, click **"More Actions"** → **"SDK Manager"**
3. Note the **Android SDK Location** (typically `C:\Users\YOUR_USERNAME\AppData\Local\Android\Sdk`)

## Step 3: Install Required SDK Components

In Android Studio SDK Manager:

### SDK Platforms Tab

Check and install:
- **Android 13.0 (Tiramisu)** - API Level 33 ✓
- **Android 14.0 (UpsideDownCake)** - API Level 34 ✓

### SDK Tools Tab

1. Check **"Show Package Details"** at bottom right
2. Expand **Android SDK Build-Tools** and install:
   - 34.0.0 ✓
   - 33.0.0 ✓
3. Ensure these are installed:
   - **Android SDK Platform-Tools** ✓
   - **Android Emulator** ✓
   - **Android SDK Command-line Tools (latest)** ✓
4. For emulator acceleration:
   - Intel systems: **Intel x86 Emulator Accelerator (HAXM)**
   - AMD systems: **Android Emulator Hypervisor Driver**

Click **"Apply"** to install selected components.

## Step 4: Configure Environment Variables

### Open Environment Variables Dialog

1. Press `Win + X` → Select **"System"**
2. Click **"Advanced system settings"** (right sidebar)
3. Click **"Environment Variables"** button

### Add User Variables

Click **"New"** under User variables section:

#### ANDROID_HOME

- Variable name: `ANDROID_HOME`
- Variable value: `C:\Users\VICTUS\AppData\Local\Android\Sdk`

**Note:** Replace `VICTUS` with your actual Windows username if different.

#### JAVA_HOME (if not set automatically)

- Variable name: `JAVA_HOME`
- Variable value: `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot`

**Note:** Check the actual folder name in Program Files\Eclipse Adoptium.

### Update PATH Variable

1. Find **"Path"** in User variables, select it, click **"Edit"**
2. Click **"New"** and add these entries (one per line):

```
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
%ANDROID_HOME%\tools
%ANDROID_HOME%\tools\bin
%JAVA_HOME%\bin
```

3. Click **"OK"** on all dialogs to save

## Step 5: Verify Setup

### Restart Your Terminal

**CRITICAL:** Close all PowerShell/Command Prompt windows and open a new one for environment variables to take effect.

### Run Verification Script

Navigate to the Guardian Angel project root:
```powershell
cd ~\Desktop\guardianangel\guardianangel
.\verify-android-setup.bat
```

### Expected Output

```
Verifying Android SDK Setup...

Checking ANDROID_HOME:
ANDROID_HOME=C:\Users\VICTUS\AppData\Local\Android\Sdk

Checking adb (Android Debug Bridge):
Android Debug Bridge version x.x.xx

Checking emulator:
Android Emulator version x.x.x

Checking Java (required for Gradle):
openjdk version "17.x.x"
```

### Manual Verification Commands

```powershell
java -version
adb --version
emulator -list-avds
```

## Step 6: Create an Android Virtual Device (AVD)

### Using Android Studio

1. Open Android Studio
2. Click **"More Actions"** → **"Virtual Device Manager"**
3. Click **"Create Device"**
4. Select a device definition (recommended: **Pixel 5** or **Pixel 6**)
5. Select a system image:
   - **API Level 33 (Android 13)** or **API Level 34 (Android 14)**
   - Choose **x86_64** or **arm64-v8a** architecture
   - Click **"Download"** if not already installed
6. Click **"Next"**, name your AVD (e.g., "Pixel_5_API_33")
7. Click **"Finish"**

### Using Command Line

```powershell
# List available system images
sdkmanager --list

# Create AVD
avdmanager create avd -n Pixel_5_API_33 -k "system-images;android-33;google_apis;x86_64" -d pixel_5
```

## Step 7: Install React Native CLI

Open PowerShell as Administrator:

```powershell
npm install -g react-native-cli
```

## Step 8: Install Mobile App Dependencies

Navigate to the mobile directory:

```powershell
cd ~\Desktop\guardianangel\guardianangel\mobile
npm install
```

## Running the App

### Start Metro Bundler

In the mobile directory:
```powershell
npm start
```

### Launch on Emulator (New Terminal)

```powershell
# Start an emulator first
emulator -avd Pixel_5_API_33

# In another terminal, run the app
npm run android
```

### Launch on Physical Device

1. Enable Developer Options on your Android device:
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times
2. Enable USB Debugging:
   - Settings → Developer Options → USB Debugging
3. Connect device via USB
4. Verify connection:
   ```powershell
   adb devices
   ```
5. Run the app:
   ```powershell
   npm run android
   ```

## Troubleshooting

### "adb not found" or "emulator not found"

- Verify `ANDROID_HOME` points to correct SDK location
- Ensure PATH includes `%ANDROID_HOME%\platform-tools` and `%ANDROID_HOME%\emulator`
- **Restart your terminal**

### "Java not found"

- Verify JDK 17 is installed in `C:\Program Files\Eclipse Adoptium\`
- Verify `JAVA_HOME` is set correctly
- Verify `%JAVA_HOME%\bin` is in PATH

### Emulator won't start

- Check if Hyper-V is enabled (Settings → Apps → Optional Features → More Windows Features)
- Intel CPUs: Install HAXM from SDK Manager
- AMD CPUs: Install Android Emulator Hypervisor Driver from SDK Manager

### "SDK location not found"

Create/edit `mobile/android/local.properties`:
```properties
sdk.dir=C:\\Users\\VICTUS\\AppData\\Local\\Android\\Sdk
```

**Note:** Use double backslashes (`\\`) in the path.

### Gradle build fails

Clear Gradle cache:
```powershell
cd mobile\android
.\gradlew clean
.\gradlew build
```

### Port 8081 already in use

```powershell
# Find process using port 8081
netstat -ano | findstr :8081

# Kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

## Next Steps

Once your environment is set up:

1. Review `mobile/README.md` for app-specific setup
2. Read `CLAUDE.md` for project architecture
3. Start the backend server (see `backend/README.md`)
4. Begin development on the Guardian Angel mobile app

## Useful Commands Reference

```powershell
# Check connected devices
adb devices

# List available emulators
emulator -list-avds

# Start specific emulator
emulator -avd Pixel_5_API_33

# View Android logs
adb logcat

# Reverse proxy for backend connection
adb reverse tcp:3000 tcp:3000

# Restart Metro bundler
npm start -- --reset-cache

# Build Android APK
cd mobile\android
.\gradlew assembleRelease
```

## Platform Versions

Confirmed working configuration:
- Node.js: 18.x or 20.x
- React Native: 0.86
- JDK: 17.x.x (Temurin)
- Android SDK: API 33/34
- Gradle: 8.x (auto-managed by React Native)

## Additional Resources

- [React Native Environment Setup](https://reactnative.dev/docs/environment-setup)
- [Android Developer Documentation](https://developer.android.com/docs)
- [Guardian Angel CLAUDE.md](./CLAUDE.md) - Project architecture and conventions
