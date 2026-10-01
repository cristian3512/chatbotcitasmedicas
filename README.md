# Chatbot de citas médicas

Chatbot básico para agendar citas con Node.js y OpenAI API

## Ejecutar

1. Instala Node.js 20 o superior.
2. Agrega tu API key de OpenAI al archivo .env. 
3. En caso de no tener una API Key, el proyecto se puede correr de forma local con limitaciones y tomando decisiones en base a palabras clave definidas en la funciones.
4. Ejecuta `npm start` en el directorio del proyecto con CMD o PowerShell y abre http://localhost:3000.
5. Una vez se concluya la cita se guardará en "citas" de la carpeta "Data" y todo el historial de la conversación se guardará en "conversaciones"


## Incluye

- Respuestas conversacionales con Responses API y function calling.
- Herramientas "consultar_medicos" y "Agendar_cita".
- El servidor valida médico, turno disponible y nombre antes de registrar.
- Citas e historiales de conversación almacenados en JSON (lo ideal es guardar los datos en una bd pero por cuestiones prácticas se guardará en un JSON).
- El próximo día correspondiente se calcula para guardar la fecha de la cita.

## Límites

El bot no diagnostica ni recomienda medicamentos o tratamientos. Esta demo local no debe usarse con datos clínicos reales; un despliegue real necesita almacenamiento seguro, autenticación y controles de privacidad.
La única función del bot es guiar al paciente a su reserva de cita en base a los requerimientos o dolencias que este posee, el bot puede recomendar áreas pero la decisión final la tiene el usuario.
