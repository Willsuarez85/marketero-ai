# Marketero AI 🤖📱

**Agentes de marketing automatizado para negocios locales**

Marketero AI utiliza [Clawdbot](https://github.com/clawdbot/clawdbot) para crear agentes inteligentes que gestionan el marketing digital de pequeños negocios de forma autónoma.

## 🎯 Concepto

Un solo agente de IA puede manejar el marketing de múltiples negocios del mismo nicho, ejecutando tareas diarias como:

- 📸 Publicar contenido en redes sociales
- 💬 Responder mensajes y comentarios
- 📊 Analizar métricas y ajustar estrategia
- 🎨 Generar contenido visual con IA
- 📅 Mantener calendario de publicaciones

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                   Docker Host                        │
├─────────────────────┬───────────────────────────────┤
│   marketero-v1      │      marketero-v2             │
│   (Restaurantes)    │      (Servicios/iFiXX)        │
│                     │                               │
│   • La Única        │      • iFiXX                  │
│   • Cafecito Tech   │      • (futuros clientes)     │
│   • (más clientes)  │                               │
├─────────────────────┴───────────────────────────────┤
│              Clawdbot + Chromium + Node.js          │
└─────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Requisitos
- Docker & Docker Compose
- API Keys: OpenAI/Anthropic, Meta Business, etc.

### Configuración

1. **Clonar repositorio**
```bash
git clone https://github.com/Willsuarez85/marketero-ai.git
cd marketero-ai
```

2. **Configurar variables de entorno**
```bash
# Editar docker-compose.yml con tus API keys
# ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
```

3. **Levantar agentes**
```bash
docker compose up -d
```

4. **Verificar status**
```bash
docker compose logs -f marketero-v1
```

## 📁 Estructura de Datos

```
/data/
├── memory/           # Memoria persistente del agente
├── projects/         # Configuración por cliente
│   ├── la-unica/
│   ├── cafecito-tech/
│   └── ifixx/
└── skills/           # Skills de Clawdbot
```

## 🔧 Configuración por Cliente

Cada cliente tiene su carpeta en `/data/projects/` con:

- `brand-guidelines.md` - Voz, colores, estilo
- `content-calendar.md` - Calendario de publicaciones
- `credentials.json` - Tokens de redes sociales
- `metrics.json` - KPIs y objetivos

## 📈 Roadmap

### Fase 1: MVP (Semana 1-2)
- [x] Docker setup con Clawdbot
- [ ] Skill de publicación Instagram
- [ ] Skill de generación de contenido
- [ ] Integración con 2 clientes piloto

### Fase 2: Automatización (Semana 3-4)
- [ ] Cron jobs para publicaciones automáticas
- [ ] Respuesta automática a comentarios
- [ ] Dashboard de métricas

### Fase 3: Escala (Mes 2+)
- [ ] Onboarding self-service
- [ ] Múltiples nichos de negocio
- [ ] White-label para agencias

## 🤝 Parte de Simplicity Agency

Marketero AI es un producto de [Simplicity Agency](https://simplicityagency.com), enfocado en democratizar el marketing digital para pequeños negocios.

## 📄 Licencia

MIT - Usa, modifica, comparte.

---

*Built with 🦁 by Jarvis & StarLord*
