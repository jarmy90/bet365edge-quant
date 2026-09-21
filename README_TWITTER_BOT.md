# 🤖 Bot de Twitter / X Automatizado v2.0 para EDGE.FUTBOL

Bot autónomo de **alta sigilosidad (Stealth)** diseñado para publicar automáticamente entre **1 y 5 oportunidades +EV diarias** de fútbol extraídas directamente de `https://edge.futbol/api/fixtures-hoy`. 

Diseñado para funcionar **100% GRATIS** mediante automatización de navegador real con Puppeteer, sin costes de API oficiales.

---

## 📁 Estructura del Proyecto

```
c:\Users\hp\Documents\Nueva carpeta (2)\
├── twitter_bot_engine.js      ← Motor principal v2.0
├── twitter_cron_runner.js     ← Programador con horarios aleatorizados
├── utils/
│   ├── stealth.js             ← Simulación humana, viewports y user-agents
│   ├── templates.js           ← 6 estilos de plantillas de tuit
│   └── imageGenerator.js      ← Generador de tarjetas visuales (PNG)
├── data/
│   ├── twitter_posted_history.json  ← Historial 48h de desduplicación
│   └── x_session_data/              ← Sesión persistente de Chrome
├── .env.example
├── .env                       ← Credenciales locales (crear a mano)
└── README.md
```

---

## 🛠️ Instalación y Configuración

1. **Copiar archivo de configuración**:
   ```bash
   cp .env.example .env
   ```

2. **Configurar credenciales en `.env`**:
   ```env
   X_USERNAME=tu_usuario_o_handle
   X_PASSWORD=tu_contrasena
   X_EMAIL=tu_email_asociado
   MIN_EDGE_PERCENT=3.0
   ```

---

## 🚀 Flujo de Ejecución Recomendado

### 1. Iniciar sesión por primera vez (Guardar Sesión)
Abre el navegador visible para loguearse e iniciar la cookie en `data/x_session_data/`:
```bash
npm run bot:twitter:login
```

### 2. Probar en Modo Simulación (Dry Run)
Prueba la recolección de datos, la rotación de plantillas y la tarjeta gráfica sin publicar en X:
```bash
npm run bot:twitter:test
```

### 3. Publicación Real Única
Busca la oportunidad número 1 con mayor ventaja que no haya sido publicada en las últimas 48 horas y la publica:
```bash
npm run bot:twitter
```

### 4. Automatización 24/7 (Daemon con Horarios Aleatorios)
Mantiene el bot activo ejecutándose en intervalos aleatorios entre 2.5 y 4.5 horas:
```bash
npm run bot:twitter:daemon
```

---

## 🛡️ Medidas de Seguridad & Anti-Ban v2.0

| Característica | Descripción / Funcionamiento |
| :--- | :--- |
| **Rotación de Viewports y User-Agent** | Selecciona aleatoriamente resoluciones (1920x1080, 1440x900, 1366x768...) y User-Agents de Chrome actualizados. |
| **Eliminación de `navigator.webdriver`** | Sobrescribe las banderas de automatización para pasar desapercibido ante Cloudflare y X. |
| **Mecanografía Natural Humana** | Introduce letras una a una con micro-pausas aleatorias entre 70ms y 160ms por carácter, añadiendo descansos en espacios e intros. |
| **Pausas Aleatorias entre Acciones** | Delays humanos de 2.2s a 5.8s antes de pulsar botones o cambiar de pestaña. |
| **Horarios no Repetitivos (Jitter)** | El ejecutor cron añade una variación de +/- 45 minutos a la hora programada para no tuitear nunca al mismo minuto. |
| **Desduplicación 48 Horas** | Comprueba en `data/twitter_posted_history.json` que el partido + mercado + cuota no hayan sido tuiteados en los últimos 2 días. |
| **Detección de Captchas / Kill-Switch** | Si detecta un desafío de seguridad o Captcha en la página de X, el bot se aborta inmediatamente y envía una advertencia a los registros para proteger la cuenta. |
