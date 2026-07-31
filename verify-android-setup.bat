@echo off
echo Verifying Android SDK Setup...
echo.

echo Checking ANDROID_HOME:
echo %ANDROID_HOME%
echo.

echo Checking adb (Android Debug Bridge):
where adb
adb version
echo.

echo Checking emulator:
where emulator
emulator -list-avds
echo.

echo Checking Java (required for Gradle):
java -version
echo.

echo If all commands above show valid output, your setup is complete!
echo Otherwise, review the steps and ensure environment variables are set.
pause
