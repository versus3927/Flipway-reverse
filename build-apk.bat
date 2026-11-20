@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === ОЧИСТКА ===
rmdir /s /q android 2>nul
rmdir /s /q dist 2>nul
del /q capacitor.config.json 2>nul
del /q capacitor.config.ts 2>nul

echo === NPM INSTALL ===
call npm install
if errorlevel 1 goto :err
call npm install --no-save @capacitor/core @capacitor/cli @capacitor/android
if errorlevel 1 goto :err

echo === СБОРКА ИГРЫ ===
call npm run build
if errorlevel 1 goto :err

echo === СОЗДАНИЕ ANDROID ПРОЕКТА ===
call npx cap init "GRAVI-RAN" com.gravi.ran --web-dir=dist
if errorlevel 1 goto :err
call npx cap add android
if errorlevel 1 goto :err
call npx cap sync android
if errorlevel 1 goto :err

echo === НАСТРОЙКА SDK И JAVA ===
if "%ANDROID_HOME%"=="" (
    set "ANDROID_SDK=%LOCALAPPDATA%\Android\Sdk"
) else (
    set "ANDROID_SDK=%ANDROID_HOME%"
)
if "%JAVA_HOME%"=="" if exist "C:\Program Files\Android\Android Studio\jbr" (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
)
if not "%JAVA_HOME%"=="" set "PATH=%JAVA_HOME%\bin;%PATH%"

echo sdk.dir=%ANDROID_SDK:\=\\%> android\local.properties

echo === СБОРКА APK ===
cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto :err
cd ..

if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    if not exist "apk" mkdir apk
    copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "apk\gravi-ran.apk" >nul
    echo.
    echo ========================================
    echo ГОТОВО! APK: apk\gravi-ran.apk
    echo ========================================
    explorer "apk"
) else (
    goto :err
)
pause
exit /b 0

:err
echo.
echo ОШИБКА при сборке. Проверь Node.js, Java 21 и Android SDK, или открой папку android в Android Studio.
pause
exit /b 1
