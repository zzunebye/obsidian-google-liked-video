# Geulo: biblioteca de YouTube y resúmenes con IA para Obsidian

[![Latest release](https://img.shields.io/github/v/release/zzunebye/obsidian-google-liked-video?label=release)](https://github.com/zzunebye/obsidian-google-liked-video/releases/latest)
[![Obsidian 1.13.0+](https://img.shields.io/badge/Obsidian-1.13.0%2B-7C3AED?logo=obsidian)](https://obsidian.md/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <a href="./README.md">English</a> |
  <strong>Español</strong> |
  <a href="./README.ko.md">한국어</a>
</p>

**Tu biblioteca de YouTube, conectada a tus notas de Obsidian.**

YouTube está hecho para que sigas viendo. Geulo devuelve a Obsidian lo que ya viste, para leerlo junto a tus notas. Trae los videos que te gustan, tus listas de reproducción y tus suscripciones. Los encuentras otra vez con la búsqueda y los filtros. Puedes leer transcripciones, generar resúmenes con IA y guardar lo visto como notas Markdown.

> Para configurar Geulo necesitas tus propias credenciales OAuth de Google. Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/). Activa YouTube Data API v3 y genera las credenciales del cliente OAuth. Con ellas el complemento accede a tu cuenta de YouTube y obtiene los videos que te gustan, las listas y las suscripciones. Los pasos están en [Requisitos](#requisitos).

La interfaz del complemento está en inglés, coreano o chino simplificado, según el idioma de Obsidian. Con Obsidian en español, los menús de Geulo salen en inglés. Esta guía usa esos nombres.

## Contenido

- [Funciones](#funciones)
- [Requisitos](#requisitos)
- [Configuración del resumen con IA](#configuración-del-resumen-con-ia)
- [Consejos](#consejos)
- [Soporte](#soporte)
- [Notas de la versión](./README.md#release-notes), en inglés

## Funciones

- **Videos que te gustan.** Consulta los videos que marcaste con me gusta en YouTube.
- **Listas de reproducción.** Abre tus listas y añade otras con su ID.
- **Añadir un video con me gusta a una lista.** Haz clic derecho en el video, elige **Add to playlist** y busca una de tus listas de YouTube. Geulo comprueba si el video ya está antes de añadirlo. Geulo mantiene el me gusta.
- **Búsqueda y filtro por tipo.** Busca, filtra y ordena por título, canal, etiquetas y tipo de contenido. Los tipos son Long-form, Short-form y Music.

    > El filtro Short-form usa la duración. YouTube Data API no marca los Shorts de forma oficial. El límite es el valor de Settings, Video display, Maximum Short-form duration. Geulo trata como Short-form los videos que no superan esa duración. Puede incluir videos normales que no superan el límite. Puede dejar fuera Shorts más largos que el límite.

- **Notas de video.** Crea una nota con un clic y escribe en ella. También puedes guardarlas en carpetas por canal.
- **Tu me gusta en la nota.** `liked: true` y `liked: false` guardan la última valoración confirmada de la cuenta de YouTube conectada a Geulo. `likes` sigue siendo el total de me gusta del video. Geulo comprueba el valor al crear o abrir una nota desde una tarjeta o desde Web Viewer. También actualiza las notas existentes después de un me gusta, de quitarlo, de Undo y de sincronizar los videos que te gustan. Recent sync confirma los me gusta obtenidos en esa sincronización. Full scan revisa además las notas que ya existían fuera de esa lista. Las plantillas propias pueden usar `{{liked}}`. Si la consulta falla o el estado es desconocido, Geulo mantiene el valor anterior y deja el nuevo vacío. Borrar la lista guardada deja esta propiedad igual. Editar la propiedad en la nota deja igual el me gusta en YouTube.
- **Nota diaria.** Añade el enlace del video a tu nota diaria con un clic.
- **Quitar videos de la lista.** Quita videos de tu lista de me gusta desde Obsidian.
- **Resúmenes con IA.** Genera resúmenes con Google Gemini, OpenRouter u OpenAI. Gemini analiza el video directamente. OpenRouter y OpenAI resumen la transcripción elegida. El resumen tiene una vista previa de una línea, que se puede plegar, y el texto completo.
- **Añadir el resumen a la nota.** Añade el resumen generado a la nota del video.
- **Transcripción.** En el menú de la tarjeta, dentro de videos que te gustan, listas o suscripciones, elige **Read transcript**. Lee los subtítulos que ya tiene YouTube, con enlaces a la marca de tiempo, y copia el texto. No hace falta otra clave de API. Geulo elige primero los subtítulos en el idioma de la aplicación. Si no están, elige inglés y después el primer idioma disponible. El acceso usa endpoints no oficiales de YouTube. En algunos videos no hay subtítulos, o la petición queda bloqueada un tiempo. Geulo pide los subtítulos al abrirlos y no los guarda solo.
- **Información del video.** Muestra los datos del video con un clic.
- **Buscar por canal.** Al pulsar el canal en la tarjeta, Geulo busca por el nombre de ese canal.
- **Varios idiomas.** La interfaz está en inglés, coreano o chino simplificado. Geulo sigue el idioma de Obsidian. Vuelve a cargar el complemento después de cambiarlo.

Geulo parte del complemento [obsidian-google-calendar](https://github.com/YukiGasai/obsidian-google-calendar).

## Requisitos

Necesitas un proyecto en Google Cloud Console con YouTube Data API v3 activada.

1. **Instala el complemento.** En los complementos de la comunidad de Obsidian, busca "Geulo".
2. **Actívalo.** En Obsidian, ve a Settings, Community plugins, y enciende Geulo.
3. **Prepara las credenciales.** Sigue la sección siguiente.

### Configuración de Google Cloud Console y YouTube Data API v3

YouTube Data API v3 usa una cuota. Cada llamada resta unidades de la cuota diaria. La API no cobra dinero. La cuota se cuenta en unidades.

El nombre en inglés va primero. Detrás va el nombre habitual en la consola en español.

#### 1. Crea un proyecto

- Abre [Google Cloud Console](https://console.cloud.google.com/).
- En la lista de proyectos, elige **New Project**. En la consola en español es Proyecto nuevo.
- Escribe un nombre y pulsa **Create**. En la consola en español es Crear.

#### 2. Activa YouTube Data API v3

- Ve a **API & Services**, **Library**. En la consola en español es API y servicios, Biblioteca.
- Busca YouTube Data API v3 y ábrela.
- Pulsa **Enable**. En la consola en español es Habilitar.

#### 3. Crea las credenciales

- Ve a **API & Services**, **Credentials**. En la consola en español es API y servicios, Credenciales.
- En **Create Credentials**, elige **OAuth client ID**. En la consola en español es Crear credenciales, ID de cliente de OAuth.
- Si te pide configurar la pantalla de consentimiento, complétala.
- Elige **Web application** y ponle un nombre. En la consola en español es Aplicación web.
- En **Authorized JavaScript origins**, añade `http://127.0.0.1:42813`. En la consola en español es Orígenes de JavaScript autorizados.
- En **Authorized redirect URIs**, añade `http://127.0.0.1:42813/callback`. En la consola en español es URIs de redireccionamiento autorizados.
- Pulsa **Create** y copia el Client ID y el Client secret.

#### 4. Permite el inicio de sesión

- Abre Google Cloud Console en el proyecto que creaste para este complemento.
- Ve a **Audience** dentro de Google Auth Platform. Es la pantalla que sustituye a la antigua pantalla de consentimiento de OAuth.
- Comprueba estos valores.
    - **Publishing status** es **Testing**. En la consola en español, Estado de publicación es Prueba.
    - **User type** es **External**. En la consola en español, Tipo de usuario es Externo.
- En **Test users**, pulsa **Add users** y añade la cuenta de Google que usas en Obsidian. En la consola en español es Usuarios de prueba, Agregar usuarios. Un ejemplo es `yourname@gmail.com`.
- Guarda.

> En modo de prueba hay que volver a conectar a los 7 días. La autorización de Google para el acceso de Geulo a YouTube caduca 7 días después de concederla. El token de actualización caduca con ella. Vuelve a conectar la cuenta de Google en Geulo para seguir obteniendo videos.
>
> Para seguir usándolo, en Audience de Google Auth Platform elige **Publish app**. En la consola en español es Publicar aplicación. Pasa el estado a **In production**. En la consola en español es En producción. Después reconecta Geulo para obtener tokens nuevos. El límite de 7 días del modo de prueba desaparece en ese momento. Los tokens aún pueden caducar o revocarse. Publicar la aplicación y la verificación de Google son pasos distintos. Puede quedar el aviso de aplicación no verificada, y los requisitos de verificación que correspondan. Consulta la [guía de Google sobre el estado de publicación](https://support.google.com/cloud/answer/15549945?hl=es).

#### 5. Introduce las credenciales en el complemento

- En Obsidian, abre Settings, Geulo, **Google connection**.
- Hay dos formas de introducirlas.
    - **Import JSON.** Descarga el JSON del cliente OAuth en **Clients**, dentro de Google Auth Platform. En Geulo, pulsa **Import JSON** y selecciona el archivo. Revisa el tipo de cliente, el proyecto y el Client ID. Pulsa **Save credentials**. Geulo acepta JSON de cliente Web y Desktop. No acepta claves de cuenta de servicio. Geulo lee el archivo en este dispositivo. El Client secret se guarda en Obsidian SecretStorage. Si ya hay una cuenta conectada, desconéctala antes de sustituir las credenciales.
    - **Entrada manual.** Abre **Google API credentials** e introduce el Client ID y el Client secret.
- Pulsa **Connect with Google** para iniciar sesión. Guardar el JSON no inicia sesión. En ese paso Geulo tampoco comprueba la API ni la configuración de consentimiento del proyecto.

#### 6. Confirma que la autenticación funcionó

- Si el flujo OAuth termina, el navegador abre una dirección como `http://127.0.0.1:42813/callback?code=...&scope=...`.
- La página muestra este texto.
    > Authentication successful! Please return to Obsidian.
- Cierra esa pestaña. Obsidian muestra que has iniciado sesión.

### Solución de problemas

1. **Credenciales.** Comprueba que el Client ID y el Client secret de los ajustes sean los que generaste.
2. **URI autorizados.** [http://127.0.0.1:42813](http://127.0.0.1:42813) tiene que estar en los orígenes de JavaScript autorizados. [http://127.0.0.1:42813/callback](http://127.0.0.1:42813/callback) tiene que estar en los URI de redireccionamiento autorizados.
3. Si no consigues conceder permiso al proyecto de Google, mira si hay varias ventanas o pestañas del inicio de sesión. Ciérralas todas y vuelve a intentarlo.

### Datos locales de los videos

Los videos que te gustan están en `liked-videos.json`, dentro de la carpeta de este complemento. Los ajustes están aparte, en `data.json`. Al arrancar, Geulo lee la lista en memoria. Geulo guarda los cambios de forma asíncrona. Si varios cambios llegan juntos, los une en un solo guardado. Antes de sustituir el archivo, copia la versión anterior válida a `liked-videos.json.bak`.

Después de escribir y comprobar el archivo nuevo, Geulo traslada los videos que todavía estén en localStorage. Si el archivo no es válido, Geulo detiene la carga y no lo sustituye por una lista vacía. Para restaurar una copia o editar el JSON a mano, desactiva primero el complemento. Después cambia `liked-videos.json` y vuelve a activarlo. Si el archivo sincronizado cambia en otro dispositivo, la lista que Geulo tiene en memoria sigue igual. Vuelve a cargar el complemento después de sincronizar. Si dos dispositivos cambian la lista a la vez, Geulo no fusiona esos cambios. Este almacenamiento tampoco descarga de YouTube solo los videos que cambiaron.

## Configuración del resumen con IA

1. Activa **AI Summary** en los ajustes del complemento.
2. Elige un proveedor. **Gemini** analiza el video directamente. **OpenRouter** y **OpenAI** resumen a partir de la transcripción.
3. Introduce la clave de API de ese proveedor.
4. Con OpenRouter u OpenAI, selecciona o escribe un ID de modelo.
5. Puedes cambiar la instrucción del resumen.
6. Pulsa el botón de resumen en una tarjeta para generarlo.

## Consejos

Con el complemento principal Web Viewer puedes ver el video de YouTube y tomar notas dentro de Obsidian.

## Soporte

Informa de fallos y pide funciones en [GitHub Issues](https://github.com/zzunebye/obsidian-google-liked-video/issues).

Si Geulo te resulta útil, puedes apoyar el desarrollo en [Buy Me a Coffee](https://www.buymeacoffee.com/junyoungbang).

Puedes compartirlo con otras personas que usen Obsidian, en Reddit, X o tu comunidad.

Gracias por usar Geulo.
