# Geulo - Plugin de vídeos favoritos de YouTube

Convierte tus vídeos favoritos de YouTube en un potente sistema de gestión del conocimiento dentro de Obsidian.

Geulo obtiene, organiza e integra sin problemas tus vídeos favoritos de YouTube directamente en tu flujo de trabajo de Obsidian. Es ideal para investigadores, creadores de contenido y profesionales del conocimiento que consideran que revisar contenido de calidad es tan valioso como descubrir material nuevo.

**¿Por qué Geulo?** En lugar de dejar que tus vídeos favoritos se pierdan en las profundidades de YouTube, Geulo los lleva a tu base de conocimiento personal, donde puedes buscarlos, ordenarlos y referenciarlos junto con tus notas. Convierte el consumo pasivo de vídeos en construcción activa de conocimiento.

**Funcionalidades principales:**

- Accede instantáneamente a toda tu colección de vídeos favoritos de YouTube.
- Navega y gestiona tus listas de reproducción de YouTube.
- Busca, filtra y ordena para redescubrir vídeos.
- Resúmenes de vídeos generados por IA (Gemini / OpenRouter).
- Integración con un solo clic en tus notas diarias.
- Cura tu colección eliminando vídeos directamente desde la barra lateral.

Agradecemos tus comentarios. Si deseas sugerir algo, abre una incidencia.

La versión móvil sigue siendo experimental.

## Índice de contenido

- [Características](#características)
- [Configuración del resumen de IA](#configuración-del-resumen-de-ia)
- [Consejos](#consejos)
- [Requisitos](#requisitos)
- [Notas de la versión](#notas-de-la-versión)

## Características

- **Recuperación de vídeos**: Accede a todo tu historial de vídeos favoritos de YouTube.
- **Navegación por listas de reproducción**: Explora tus listas de reproducción de YouTube y añade listas personalizadas por ID.
- **Búsqueda y filtrado por tipo de contenido**: Busca, filtra y ordena tus vídeos con múltiples opciones. La búsqueda se basa en el título del vídeo, el título del canal y las etiquetas. Filtra vídeos por tipo: Vídeos, Shorts o Música.
- **Crear notas de vídeo**: Crea notas de vídeo con un solo clic y escribe tus propias notas. También puedes organizarlas por canal.
- **Integración con notas diarias**: Añade vídeos a tus notas diarias con un solo clic.
- **Curación de colecciones**: Elimina vídeos de tu lista de favoritos directamente desde Obsidian.
- **Resúmenes de vídeos con IA**: Genera resúmenes de vídeos usando Google Gemini o OpenRouter con el parámetro video_url de Gemini. Los resúmenes se muestran en tiempo real, con una vista previa de una línea plegable y un resumen completo expandible.
- **Añadir resumen a la nota**: Añade resúmenes generados por IA a tus notas de vídeo.
- **Visualización de información de vídeo**: Muestra la información del vídeo con un solo clic.
- **Búsqueda por nombre de canal**: Busca por título de canal cuando haces clic en el canal en la tarjeta de vídeo.

Está inspirado en el plugin [obsidian-google-calendar](https://github.com/YukiGasai/obsidian-google-calendar).

## Configuración del resumen de IA

1. Activa **Resumen de IA** en la configuración del plugin.
2. Elige un proveedor: **Gemini** (directo) o **OpenRouter**.
3. Introduce la clave API para el proveedor elegido.
4. (Solo OpenRouter) Selecciona o introduce un ID de modelo.
5. Opcionalmente, personaliza el mensaje del resumen.
6. Haz clic en el botón de resumen en cualquier tarjeta de vídeo para generar un resumen.

## Consejos

<img width="480" alt="imagen" src="https://github.com/user-attachments/assets/81f68f4e-3313-4bf1-a1aa-7e1a0566de7e" />

Puedes ver vídeos de YouTube y tomar notas dentro de Obsidian si activas el **Plugin principal > Visor web**.

## Requisitos

Para utilizar este plugin, es necesario configurar un proyecto en Google Cloud Console y habilitar la API de YouTube Data v3. Sigue los pasos siguientes para configurarlo:

1. **Descargar el plugin**: Ve a la página de plugins comunitarios de Obsidian y busca "Geulo".
2. **Activar el plugin**: En Obsidian, ve a Configuración > Plugins comunitarios y activa el plugin Geulo.
3. **Configurar las credenciales de la API**: Sigue los pasos en la sección "Configuración de Google Cloud Console y YouTube Data API v3" para obtener tus credenciales.

### Configuración de Google Cloud Console y YouTube Data API v3

La API de YouTube Data v3 utiliza un sistema de cuotas en el que diferentes llamadas a la API consumen un número específico de "unidades" o "puntos" de un límite diario. El uso de la API es gratuito; el "costo" se refiere a estas unidades de cuota, no a una tarifa monetaria.

Para utilizar este plugin, es necesario configurar un proyecto en Google Cloud Console y habilitar la API de YouTube Data v3.

Sigue los pasos siguientes para configurarlo:

#### 1. Crear un proyecto

- Ve a Google Cloud Console.
- Haz clic en el menú desplegable de proyectos y selecciona "Nuevo proyecto".
- Introduce un nombre para el proyecto y haz clic en "Crear".

#### 2. Habilitar YouTube Data API v3

- Ve a API y servicios > Biblioteca.
- Busca YouTube Data API v3 y haz clic en él.
- Haz clic en "Habilitar".

#### 3. Crear credenciales

- Ve a API y servicios > Credenciales.
- Haz clic en "Crear credenciales" y selecciona "ID de cliente OAuth".
- Configura la pantalla de consentimiento si se te solicita.
- Selecciona "Aplicación web" e introduce un nombre.
- En "Orígenes JavaScript autorizados", añade `http://127.0.0.1:42813`.
- En "URIs de redirección autorizados", añade `http://127.0.0.1:42813/callback`.
- Haz clic en "Crear" y copia el ID de cliente y el secreto del cliente.

#### 4. Crear permisos de inicio de sesión

- Abre Google Cloud Console para el proyecto que creaste para este plugin.
- Ve a "Plataforma de autenticación de Google → Público" (esto reemplaza la antigua interfaz "Pantalla de consentimiento de OAuth").
- Confirma:
  - **Estado de publicación** = **Prueba**
  - **Tipo de usuario** = **Externo**
- En "Usuarios de prueba", haz clic en "Añadir usuarios" y añade la cuenta de Google que usas en Obsidian (por ejemplo, `tucorreo@gmail.com`).
- Guarda los cambios.

#### 5. Introducir credenciales en el plugin

- Abre Obsidian y ve a la configuración del plugin de vídeos favoritos de YouTube.
- Introduce tu ID de cliente y tu secreto de cliente en los campos respectivos.
- Haz clic en "Iniciar sesión" para iniciar sesión en tu cuenta de Google.

#### 6. Confirmación de autenticación exitosa

- Cuando el flujo de OAuth tenga éxito, tu navegador abrirá una página en una URL como: `http://127.0.0.1:42813/callback?code=...&scope=...`
- La página mostrará:
> **¡Autenticación exitosa! Por favor, vuelve a Obsidian.**
- En ese momento, puedes cerrar la pestaña y Obsidian debería mostrar que estás conectado.

### Solución de problemas

Si encuentras algún problema, considera los siguientes pasos:

1. **Credenciales**: Verifica que tu ID de cliente y tu secreto de cliente estén correctamente introducidos en la configuración del plugin.
2. **URIs autorizados**: Verifica que `http://127.0.0.1:42813` esté listado en "Orígenes JavaScript autorizados" y que `http://127.0.0.1:42813/callback` esté en "URIs de redirección autorizados".
3. Si la concesión de permisos a tu proyecto de Google falla, verifica si hay varias ventanas o pestañas abiertas para el proceso de inicio de sesión. Si es así, cierra todas y prueba de nuevo.

## Notas de la versión

### 3.1.0

- **Función "Me gusta" para vídeos de listas de reproducción**
- **Deshacer el deslike de un vídeo desde la vista de vídeos favoritos**
- **Añadir comando de recuperación completa para vídeos favoritos**
- Añadir más comandos

### 3.0.0

- **Resúmenes de vídeos con IA**: Genera resúmenes usando Google Gemini o OpenRouter con respuestas en tiempo real.
- **Resúmenes de una línea**: Generación automática de resúmenes breves después de completar el resumen completo.
- **Gestión de resúmenes**: Regenerar resúmenes, añadir resúmenes a notas, filtrar por nota de IA.
- **Filtrado de tipos de contenido**: Filtrar vídeos favoritos por Vídeos, Shorts o Música.
- **Interfaz de transmisión**: Visualización en vivo con carga simulada y soporte de cancelación.
- **Soporte para OpenRouter**: Usar la API de OpenRouter como proveedor alternativo de IA con selección de modelo.
- **Mejoras en la interfaz**: Perfeccionar la interfaz en general. Componente ViewHeader reutilizable, fijar el desplazamiento del diseño de miniaturas, indicadores de chevron para secciones expandibles.

### 2.3.0

- **Sistema de plantillas**: Añadido modelo para notas de vídeo y referencia para variables de plantilla disponibles.
- **Lógica de recuperación actualizada**: Ajustado el límite de recuperación predeterminado a 10 y el máximo a 50 para una mejor gestión de cuotas de API.
- **Advertencia de recuperación completa**: Añadida advertencia cuando la creación automática de notas está habilitada con el modo de recuperación completa.

### 2.2.0

- **Creación automática de notas**: Crear automáticamente notas de vídeo para vídeos recién favoritos durante la recuperación automática.
- **Vinculación con notas diarias**: Opción para vincular automáticamente nuevas notas de vídeo a tu nota diaria.
- **Modo de recuperación completa**: Nueva opción para recuperar todos los vídeos favoritos en cada recuperación automática (con advertencias de cuota y confirmación del usuario).
- **Sistema de plantillas**: Personaliza notas de vídeo con tus propias plantillas de Markdown.
  - Configurar carpeta de plantillas y plantilla predeterminada.
  - Opción de retroceso a plantilla integrada.
  - Crear plantillas de ejemplo con un solo clic.

### 2.1.0

- **Mejoras en la interfaz**: Reemplazados los iconos con iconos de Lucide React para una mejor consistencia.
- **Corrección de errores**: Corregido el color de visualización de la etiqueta de duración.

### 2.0.1

- **Seguridad de tipos**: Mejorada la seguridad de tipos en PlaylistApi.

### 2.0.0

- **Integración mejorada con notas diarias**: Añadir entradas de vídeo a notas diarias con mejor manejo de errores.
- **Fijación de listas de reproducción**: Fijar tus listas de reproducción favoritas para un acceso rápido.
- **Desplazamiento infinito**: Desplazamiento infinito suave para la carga de vídeos en listas de reproducción.
- **Optimización de rendimiento**: Límite de visualización de vídeos para un mejor rendimiento.
- **Mejora del almacenamiento en caché**: Gestión mejorada de caché en PlaylistApi.
- **Refinamientos de la interfaz**: Actualizados los nombres de las etiquetas del icono de la cinta y los nombres de los comandos para mayor claridad.
