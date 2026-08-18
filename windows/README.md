# Nexit Alarm Bridge para Windows
1. Ejecuta `NexitAlarmBridge.exe` una vez. Puede quedarse minimizado/sin ventana: escucha solo en `127.0.0.1:51338`.
2. Nexit web le envía una copia local de los horarios.
3. El Bridge crea tareas semanales en el Programador de tareas de Windows y una tarea de inicio de sesión para volver a arrancar el Bridge.
4. Las alarmas programadas no dependen de Supabase ni de que Nexit esté abierta.

La sincronización de datos sigue siendo Supabase; el Bridge solo recibe horarios y posposiciones locales.
