# ⚡ TurboTX — Bitcoin Transaction Accelerator

<div align="center">

![TurboTX](https://img.shields.io/badge/TurboTX-v14.1-f7931a?style=for-the-badge&logo=bitcoin&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=for-the-badge&logo=vercel)
![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Status](https://img.shields.io/badge/Status-Live-00e87a?style=for-the-badge)

**[🚀 Live App](https://acelerat.vercel.app)** • **[📖 API Docs](https://acelerat.vercel.app/api-docs)** • **[💬 Telegram](https://t.me/Sup_TurboTX)**

</div>

---

## 🔥 What is TurboTX?

TurboTX broadcasts stuck Bitcoin transactions to **30 channels** — 8 full nodes + 22 mining pool accelerators — covering **~88% of Bitcoin hashrate**. Includes MARA Slipstream private mempool bypass, **Lightning Network payments**, **HMAC‑secured activation tokens**, and a **Smart Advisor** for optimal acceleration decisions.

---

## 📖 English

### 📁 Repository Structure

```

T_U_R_B_O_T_X/
├── api/                        # Vercel Serverless Functions
│   ├── v1.js                   # Public API v1 (auth + rate limits, key management)
│   ├── router.js               # Unified router (health, status, stats, price, mempool, cpfp, rbf, acceleration)
│   ├── broadcast.js            # Core TX broadcast engine (v14.1)
│   ├── verify.js               # Payment verification (BTC/USDT/Lightning) with HMAC token generation
│   ├── repeat.js               # 10-wave adaptive repeat broadcast
│   ├── lightning.js            # Lightning Network invoice handler
│   ├── telegram.js             # Telegram notifications
│   └── _shared.js              # Common utilities (CORS, rate limiting, HMAC functions)
│
├── public/                     # Static files (outputDirectory in vercel.json)
│   ├── index.html              # Main SPA (v14.1, ~7000 lines)
│   ├── client-api.js           # Frontend API client
│   ├── api-docs.html           # Public API documentation
│   ├── robots.txt
│   └── sitemap.xml
│
├── .env.example                # Environment variables template
├── package.json                # Node 24.x, ES modules
├── vercel.json                 # Routing, CORS, function config
└── README.md

```

### 🚀 Deploy to Vercel

#### 1. Fork & Clone
```bash
git clone https://github.com/ProjectBarabashka/T_U_R_B_O_T_X
cd T_U_R_B_O_T_X
```

2. Set Environment Variables

```bash
cp .env.example .env.local
# Fill in your values
```

Required variables in Vercel dashboard:

Variable Description
BTC_WALLET Bitcoin receiving address
USDT_WALLET USDT TRC-20 address
LIGHTNING_ADDRESS Lightning address (e.g., user@domain.com)
TG_TOKEN Telegram bot token
TG_CHAT_ID Telegram notification chat ID
PREMIUM_SECRET Secret for HMAC token generation (never sent to client)
ADMIN_SECRET Admin API access secret

3. Deploy

```bash
npx vercel --prod
```

Or connect repo to vercel.com for automatic deploys on push.

🔌 Public API

Full documentation at acelerat.vercel.app/api-docs

```bash
# Check TX status
curl "https://acelerat.vercel.app/api/v1?method=status&txid=YOUR_TXID" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY"

# Accelerate stuck TX
curl -X POST "https://acelerat.vercel.app/api/v1?method=accelerate" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txid":"YOUR_TXID","plan":"premium"}'
```

API Endpoints

Method Endpoint Description
GET ?method=ping Verify key + rate limits
GET ?method=status&txid= Full TX analysis
GET ?method=mempool Network state
GET ?method=fees Recommended fee rates
GET ?method=price Dynamic pricing
GET ?method=acceleration&txid= Smart advisor
POST ?method=accelerate Submit TX for boost
POST ?method=batch Batch accelerate up to 20 TX
GET ?method=cpfp&txid= CPFP calculator
GET ?method=rbf&txid= RBF calculator
GET ?method=health Service health
GET/POST ?method=keys API key management (admin)

API Tiers

Tier Rate Limit Price
Free 30 req/min · 500/day $0
Basic 100 req/min · 5k/day $29/mo
Pro 500 req/min · 50k/day $99/mo
Partner Unlimited Custom

⚡ Key Features (v14.1)

· ~88% Hashrate Coverage — Foundry, AntPool, MARA, ViaBTC, SpiderPool + 17 more
· MARA Slipstream — Private mempool bypass
· Smart Advisor — Decision engine with cost analysis, time forecast, rescue plan
· 10-Wave Broadcast — Adaptive intervals (15/15/30/60/120/120/120/120/180/180 min), anti-stuck mode for TX >72h
· Lightning Payments — Invoice generation + verification, HMAC‑secured activation
· Dynamic Pricing — Based on real-time mempool + fee signals (dual‑signal: fee rate + queue size)
· HMAC Activation Tokens — Premium secret never leaves server, preventing client‑side theft
· Multi-language — Auto‑translation to any language (RU/EN built‑in)
· Batch Acceleration — Up to 20 TX at once for Pro/Partner tiers
· Live Feed & Queue — Real-time updates via Firebase

🛠 Local Development

```bash
npm install -g vercel
vercel dev
# → http://localhost:3000
```

📜 Changelog (v14.1)

· 🔐 Security: HMAC activation tokens replace raw PREMIUM_SECRET in client responses.
· 🐛 Bug fixes: Lightning invoice parser, dynamic API key authentication, hashrate reach calculation.
· ⚡ Performance: Wave count increased to 10, adaptive intervals based on fee trend and stuck hours.
· 🌐 API: Merged keys.js and acceleration.js into v1.js and router.js to save Vercel function slots.
· 💡 New: Last‑block‑miner boost, real‑time mempool congestion display, 24h fee history in /api/mempool.

⚖️ License

PROPRIETARY — © 2026 ProjectBarabashka

For licensing inquiries: pollytrazlo@gmail.com

---

📘 Русский

🔥 Что такое TurboTX?

TurboTX отправляет застрявшие Bitcoin-транзакции в 30 каналов — 8 полных нод + 22 акселератора майнинг-пулов, охватывая ~88% хешрейта Bitcoin. Включает приватный мемпул MARA Slipstream, оплату через Lightning Network, HMAC‑защищённые токены активации и Smart Advisor для оптимального ускорения.

📁 Структура репозитория

```
T_U_R_B_O_T_X/
├── api/                        # Vercel Serverless Functions
│   ├── v1.js                   # Public API v1 (auth + rate limits, управление ключами)
│   ├── router.js               # Объединённый роутер (health, status, stats, price, mempool, cpfp, rbf, acceleration)
│   ├── broadcast.js            # Основной движок рассылки (v14.1)
│   ├── verify.js               # Проверка оплаты (BTC/USDT/Lightning) с HMAC-токенами
│   ├── repeat.js               # 10-волновой адаптивный повтор
│   ├── lightning.js            # Обработка Lightning-инвойсов
│   ├── telegram.js             # Уведомления в Telegram
│   └── _shared.js              # Общие утилиты (CORS, rate limiting, HMAC)
│
├── public/                     # Статические файлы (outputDirectory в vercel.json)
│   ├── index.html              # Основное SPA (v14.1, ~7000 строк)
│   ├── client-api.js           # Клиентский API-клиент
│   ├── api-docs.html           # Документация публичного API
│   ├── robots.txt
│   └── sitemap.xml
│
├── .env.example                # Шаблон переменных окружения
├── package.json                # Node 24.x, ES modules
├── vercel.json                 # Routing, CORS, конфигурация функций
└── README.md
```

🚀 Деплой на Vercel

1. Форк и клонирование

```bash
git clone https://github.com/ProjectBarabashka/T_U_R_B_O_T_X
cd T_U_R_B_O_T_X
```

2. Установка переменных окружения

```bash
cp .env.example .env.local
# Заполните свои значения
```

Обязательные переменные в панели Vercel:

Переменная Описание
BTC_WALLET Bitcoin-адрес для оплаты
USDT_WALLET USDT TRC-20 адрес
LIGHTNING_ADDRESS Lightning-адрес (например, user@domain.com)
TG_TOKEN Токен Telegram-бота
TG_CHAT_ID ID чата для уведомлений
PREMIUM_SECRET Секрет для генерации HMAC-токенов (никогда не отправляется клиенту)
ADMIN_SECRET Секрет для административного доступа к API

3. Деплой

```bash
npx vercel --prod
```

Или подключите репозиторий к vercel.com для автоматического деплоя при пуше.

🔌 Публичное API

Полная документация: acelerat.vercel.app/api-docs

```bash
# Проверка статуса транзакции
curl "https://acelerat.vercel.app/api/v1?method=status&txid=YOUR_TXID" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY"

# Ускорение застрявшей транзакции
curl -X POST "https://acelerat.vercel.app/api/v1?method=accelerate" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txid":"YOUR_TXID","plan":"premium"}'
```

Эндпоинты API

Метод Endpoint Описание
GET ?method=ping Проверка ключа + лимиты
GET ?method=status&txid= Полный анализ TX
GET ?method=mempool Состояние сети
GET ?method=fees Рекомендуемые комиссии
GET ?method=price Динамическая цена Premium
GET ?method=acceleration&txid= Smart Advisor
POST ?method=accelerate Отправить TX на ускорение
POST ?method=batch Пакетное ускорение (до 20 TX)
GET ?method=cpfp&txid= CPFP калькулятор
GET ?method=rbf&txid= RBF калькулятор
GET ?method=health Состояние сервиса
GET/POST ?method=keys Управление API-ключами (админ)

Тарифные планы

План Лимиты Цена
Free 30 запр/мин · 500/день $0
Basic 100 запр/мин · 5k/день $29/мес
Pro 500 запр/мин · 50k/день $99/мес
Partner Без лимитов Индивидуально

⚡ Ключевые возможности (v14.1)

· ~88% хешрейта — Foundry, AntPool, MARA, ViaBTC, SpiderPool + ещё 17 пулов
· MARA Slipstream — приватный мемпул (обход обычной очереди)
· Smart Advisor — интеллектуальный анализ с оценкой стоимости, прогнозом времени и планом спасения
· 10 волн повтора — адаптивные интервалы (15/15/30/60/120/120/120/120/180/180 мин), режим anti‑stuck для TX >72ч
· Lightning Network — создание и проверка инвойсов, HMAC‑активация
· Динамическое ценообразование — на основе загрузки сети (fee rate + размер мемпула)
· HMAC‑токены активации — секрет Premium никогда не покидает сервер, защита от перехвата в DevTools
· Мультиязычность — автоматический перевод интерфейса (встроены RU/EN)
· Пакетное ускорение — до 20 транзакций одновременно для тарифов Pro/Partner
· Живая лента и очередь — обновления в реальном времени через Firebase

🛠 Локальная разработка

```bash
npm install -g vercel
vercel dev
# → http://localhost:3000
```

📜 Список изменений (v14.1)

· 🔐 Безопасность: HMAC-токены активации вместо отправки сырого PREMIUM_SECRET клиенту.
· 🐛 Исправления: парсер Lightning-инвойсов, авторизация динамических API-ключей, расчёт охваченного хешрейта.
· ⚡ Производительность: увеличено количество волн до 10, адаптивные интервалы на основе тренда комиссий и времени зависания.
· 🌐 API: объединены keys.js и acceleration.js в v1.js и router.js для экономии слотов Vercel.
· 💡 Новое: приоритет последнего добывшего блока пула, отображение реальной загрузки мемпула, история комиссий за 24ч в /api/mempool.

⚖️ Лицензия

PROPRIETARY — © 2026 ProjectBarabashka

По вопросам лицензирования: pollytrazlo@gmail.com

---

<div align="center">
  <sub>Сделано с ⚡ <a href="https://github.com/ProjectBarabashka">ProjectBarabashka</a> · <a href="https://acelerat.vercel.app">acelerat.vercel.app</a></sub>
</div>
```
