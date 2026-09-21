# 🤖 Bot de Twitter / X Automatizado para EDGE.FUTBOL (100% Gratis)

Este bot permite publicar automáticamente **de 3 a 5 veces al día** las mejores oportunidades cuantitativas de apuestas con ventaja (+EV) de fútbol directamente en tu cuenta de Twitter/X (`@edgefutbol`), sin necesidad de pagar por la API oficial de X ($100+/mes).

---

## 🛠️ Requisitos e Instalación

1. **Node.js** (v18 o superior).
2. Tener Google Chrome o Microsoft Edge instalado en el equipo.
3. Copiar el archivo de configuración de ejemplo a `.env`:
   ```bash
   cp .env.example .env
   ```

4. Editar `.env` e introducir las credenciales de la cuenta de X:
   ```env
   X_USERNAME=tu_usuario_de_x
   X_PASSWORD=tu_contrasena_de_x
   X_EMAIL=tu_email_asociado_x
   ```

---

## 🚀 Paso 1: Inicio de Sesión Único (Login Inicial)

Antes de ejecutar el bot de forma automática, debes guardar la sesión en el navegador por primera vez.

Ejecuta el comando:
```bash
npm run bot:twitter:login
```
* **¿Qué hace este paso?**: Abre un navegador Chrome visible, introduce tus credenciales y guarda las cookies cifradas en la carpeta local `./x_session_data`. **Solo necesitas hacer esto una vez.**

---

## 🧪 Paso 2: Probar el Bot en Modo Simulación (Dry Run)

Para verificar qué tuit enviaría y cómo genera la tarjeta gráfica PNG sin publicar nada en X:

```bash
npm run bot:twitter:test
```

---

## 🎯 Paso 3: Publicación Automática de 1 Oportunidad

Para buscar la mejor oportunidad del momento en `https://edge.futbol/api/fixtures-hoy` y publicarla en Twitter:

```bash
npm run bot:twitter
```

---

## ⏰ Paso 4: Dejar el Bot Funcionando Autónomamente 24/7 (Daemon)

Para mantener el bot publicando automáticamente **cada 4 horas** (aprox. 4 a 6 tuits diarios):

```bash
npm run bot:twitter:daemon
```

---

## ⚠️ Riesgos de Ban en Twitter/X y Cómo Evitarlos

El bot utiliza automatización web con navegador real (**Puppeteer + Stealth Delays**). Sin embargo, X tiene sistemas anti-spam estrictos. Sigue estas recomendaciones:

| Riesgo | Solución Implementada en el Bot |
| :--- | :--- |
| **Detección de patrones de mecanografía rápida** | Se usa `typeLikeHuman()` que introduce retrasos aleatorios entre 20ms y 70ms por carácter. |
| **Peticiones idénticas a horas exactas** | El programador introduce pausas aleatorias entre 15 y 45 segundos antes de publicar. |
| **Tuits duplicados** | Mantiene un archivo de historial `twitter_posted_history.json` para no publicar el mismo partido en 24h. |
| **Formato de texto repetitivo** | Utiliza 4 plantillas de emojis e iconos que varían aleatoriamente en cada publicación. |
| **Frecuencia excesiva** | Máximo recomendado: **3 a 5 tuits al día**. No programar intervalos inferiores a 2 horas. |

---

## 📁 Archivos del Sistema

- `twitter_bot_engine.js`: Núcleo de automatización, generador de tarjeta gráfica PNG en memoria y publicador.
- `twitter_cron_runner.js`: Demonio/programador en bucle continuo.
- `x_session_data/`: Carpeta local donde se almacena la sesión iniciada. **Nunca subir esta carpeta a repositorios públicos.**
- `twitter_posted_history.json`: Historial para evitar desduplicación.
