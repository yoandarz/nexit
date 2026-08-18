# Nexit — PWA sincronizada + alarmas locales

Arquitectura final, siguiendo el patrón probado de Taskium:

- **Supabase** sincroniza categorías, contenido diario, horarios y ajustes entre dispositivos.
- **Android** dispara sus alarmas localmente mediante `AlarmManager` desde la aplicación nativa.
- **Windows** dispara sus alarmas localmente mediante `NexitAlarmBridge.exe` y el Programador de tareas.
- **Web/PWA pura** sirve para consultar y editar datos, pero no se considera un motor fiable de alarmas con la aplicación cerrada.

## Publicación
Crea un repositorio GitHub llamado `nexit`, copia el contenido de esta carpeta a la raíz y activa GitHub Pages mediante GitHub Actions. La URL esperada por Android y Windows es:
`https://yoandarz.github.io/nexit/`

## Windows
Ejecuta `windows/NexitAlarmBridge.exe` una vez. Nexit detectará el motor local y le enviará automáticamente los horarios. El Bridge se registra para arrancar al iniciar sesión en Windows.

## Android
El workflow `.github/workflows/build-android.yml` compila el APK. Instálalo, inicia sesión y en Ajustes pulsa **Activar** dentro de Alarmas locales. Android solicitará los permisos necesarios.

## Datos migrados
Los datos de la aplicación de escritorio ya fueron cargados previamente en `nexit_records` del Supabase compartido.

## Importante
No hay cron, push remoto ni VAPID en esta versión. Los avisos son responsabilidad del dispositivo, igual que en la solución final de Taskium.
