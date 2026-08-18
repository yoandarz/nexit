# Nexit Android — alarmas locales
La app nativa carga `https://yoandarz.github.io/nexit/` y expone `NexitNativeAndroid` a la web. Los datos se sincronizan por Supabase; Android guarda una copia local de los horarios y los programa con AlarmManager. Las alarmas continúan aunque Nexit esté cerrada y se restauran tras reiniciar el teléfono.
