@echo off
chcp 65001 >nul
cd /d "C:\Users\pc\Downloads\3d-runner-with-ceiling-mechanics 4"

echo === ОЧИСТКА ===
rmdir /s /q android 2>nul
rmdir /s /q node_modules 2>nul
rmdir /s /q dist 2>nul
del /q package-lock.json 2>nul
del /q capacitor.config.json 2>nul
del /q capacitor.config.ts 2>nul

echo === NPM INSTALL ===
call npm install
call npm install @capacitor/core @capacitor/cli @capacitor/android

echo === СБОРКА ИГРЫ ===
call npm run build

echo === СОЗДАНИЕ ANDROID ПРОЕКТА ===
call npx cap init "GRAVI-RAN" com.gravi.ran --web-dir=dist
call npx cap add android
call npx cap sync android

echo === НАСТРОЙКА SDK И JAVA ===
set "ANDROID_SDK=C:\Users\pc\AppData\Local\Android\Sdk"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo sdk.dir=%ANDROID_SDK:\=\\% > android\local.properties

echo === СБОРКА APK ===
cd android
call gradlew.bat assembleDebug

if exist "app\build\outputs\apk\debug\app-debug.apk" (
    echo.
    echo ========================================
    echo ГОТОВО! Открываю папку с APK...
    echo ========================================
    explorer "app\build\outputs\apk\debug"
) else (
    echo.
    echo ОШИБКА при сборке. Попробуй открыть android папку в Android Studio.
)
pause
