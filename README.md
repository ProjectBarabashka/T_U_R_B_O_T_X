<div align="center">

```
  ████████╗██╗   ██╗██████╗ ██████╗  ██████╗ ████████╗██╗  ██╗
     ██╔══╝██║   ██║██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝╚██╗██╔╝
     ██║   ██║   ██║██████╔╝██████╔╝██║   ██║   ██║    ╚███╔╝
     ██║   ██║   ██║██╔══██╗██╔══██╗██║   ██║   ██║    ██╔██╗
     ██║   ╚██████╔╝██║  ██║██████╔╝╚██████╔╝   ██║   ██╔╝ ██╗
     ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝    ╚═╝   ╚═╝  ╚═╝
```

# ⚡ Bitcoin Transaction Accelerator

[![Version](https://img.shields.io/badge/TurboTX-v14.2-f7931a?style=for-the-badge&logo=bitcoin&logoColor=white)](https://acelerat.vercel.app)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://acelerat.vercel.app)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Status](https://img.shields.io/badge/Status-Live-00e87a?style=for-the-badge)](https://acelerat.vercel.app)
[![Stars](https://img.shields.io/github/stars/ProjectBarabashka/T_U_R_B_O_T_X?style=for-the-badge&color=f7931a)](https://github.com/ProjectBarabashka/T_U_R_B_O_T_X)

**[🚀 Live App](https://acelerat.vercel.app)** · **[📖 API Docs](https://acelerat.vercel.app/api-docs)** · **[💬 Telegram](https://t.me/Sup_TurboTX)**

<br/>

> *The fastest way to unstick a Bitcoin transaction in 2026.*

</div>

---

## 📖 English

### What is TurboTX?

Your Bitcoin transaction is stuck. The mempool is full. Miners ignore it.

TurboTX solves this by reaching **~88% of Bitcoin's active hashrate** through proprietary multi-channel broadcasting — not just a simple rebroadcast, but a coordinated intelligent push across the mining ecosystem. Premium users get **up to 10 automated retry waves** over 16 hours with zero manual effort, even if they close the browser.

---

### ✦ Why TurboTX beats the competition

| | TurboTX v14.2 | Others |
|---|---|---|
| Hashrate coverage | **~88%** | 10–40% |
| Private mempool access | ✅ MARA Slipstream | ❌ |
| Works after closing browser | ✅ Server-side waves | ❌ Browser only |
| Lightning Network payments | ✅ | Rarely |
| Smart rescue advisor | ✅ RBF / CPFP analysis | ❌ |
| Batch acceleration | ✅ Up to 20 TX | ❌ |
| API for developers | ✅ 4 tiers | ❌ |
| Anti-stuck mode (72h+) | ✅ Aggressive intervals | ❌ |
| Open source | ✅ | Usually ❌ |

---

### ⚡ Key Features

**🎯 Maximum Hashrate Reach**  
Proprietary broadcast engine reaches Foundry, AntPool, MARA, ViaBTC, SpiderPool and 17+ more pools simultaneously — covering ~88% of Bitcoin's active hashrate in a single acceleration.

**🔒 MARA Slipstream**  
Direct injection into MARA's private mempool. Your transaction bypasses the public queue entirely and lands directly in front of MARA miners — the #3 pool by hashrate.

**🌊 Persistent 10-Wave System**  
Premium transactions receive up to 10 rebroadcast waves over 16 hours. Unlike competitors whose "auto-retry" dies the moment you close the tab, TurboTX waves run server-side — they fire on schedule whether you're online or not.

**🧠 Smart Advisor**  
Before you pay, TurboTX analyses your transaction: current fee vs network rate, mempool position, stuck duration, RBF eligibility, CPFP cost. You get a clear rescue plan with exact cost estimates — not just a "boost" button.

**⚡ Lightning Network**  
Instant payments via Lightning Network with automatic invoice generation and real-time confirmation detection. HMAC-secured activation tokens mean your premium access can never be intercepted from browser DevTools.

**📊 Live Mempool Intelligence**  
Dual-signal congestion detection: fee rate + mempool size. Adaptive wave intervals that shorten when fees are dropping and extend when the network is clearing — maximising confirmation chance at minimum cost.

---

### 🔌 Public API

Full documentation: [acelerat.vercel.app/api-docs](https://acelerat.vercel.app/api-docs)

```bash
# Analyse a stuck transaction
curl "https://acelerat.vercel.app/api/v1?method=status&txid=YOUR_TXID" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY"

# Submit for acceleration
curl -X POST "https://acelerat.vercel.app/api/v1?method=accelerate" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txid":"YOUR_TXID","plan":"premium"}'
```

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `?method=ping` | Verify key + remaining quota |
| `GET` | `?method=status&txid=` | Full TX analysis + rescue advice |
| `GET` | `?method=mempool` | Live network state |
| `GET` | `?method=fees` | Recommended fee rates |
| `GET` | `?method=price` | Dynamic Premium pricing |
| `GET` | `?method=acceleration&txid=` | Smart Advisor decision |
| `POST` | `?method=accelerate` | Submit TX for acceleration |
| `POST` | `?method=batch` | Accelerate up to 20 TX at once |
| `GET` | `?method=cpfp&txid=` | CPFP fee calculator |
| `GET` | `?method=rbf&txid=` | RBF bump calculator |
| `GET` | `?method=health` | Service health |
| `GET/POST` | `?method=keys` | Key management *(admin)* |

**API Tiers:**

| Tier | Limits | Price |
|---|---|---|
| Free | 30 req/min · 500/day | $0 |
| Basic | 100 req/min · 5k/day | $29/mo |
| Pro | 500 req/min · 50k/day | $99/mo |
| Partner | Unlimited | Custom |

---

### 📜 Changelog

#### v14.2 — March 2026
- 🌊 Waves now run server-side — fire on schedule even when browser is closed
- 🔄 Automatic wave state recovery on page return
- 🔧 Lightning payment stability fixes for cold-start scenarios
- 🛡 WebSocket reconnect hardening — no more "closed before established" spam
- 🔥 Improved resilience against transient network failures
- 📈 Rate limit improvements for high-frequency Premium users

#### v14.1 — 2026
- 🔐 HMAC-secured activation — Premium secret protected server-side
- 🐛 Multiple stability fixes across payment verification and broadcast engine
- ⚡ Wave system expanded from 8 to 10 with adaptive timing
- 💡 Last-block-miner priority boost, live mempool congestion display

---

### 🛠 Local Development / Research

```bash
# Requires configuration — contact via Telegram for setup details
npx vercel dev
```

---

### ⚖️ License

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange?style=flat-square)](LICENSE)

**Business Source License 1.1** — © 2026 ProjectBarabashka

Source code is available for reading and personal use.  
**Commercial use, resale, white-labelling, and competing deployments are prohibited.**  
Converts to MIT on 2029-01-01.

Commercial licensing: pollytrazlo@gmail.com · [Telegram](https://t.me/Sup_TurboTX)

---
---

## 📘 Русский

### Что такое TurboTX?

Ваша Bitcoin-транзакция застряла. Мемпул переполнен. Майнеры её игнорируют.

TurboTX решает это, охватывая **~88% активного хешрейта Bitcoin** через проприетарную многоканальную рассылку — не просто rebroadcast, а координированная умная атака на всю майнинговую экосистему. Premium-пользователи получают **до 10 автоматических волн повтора** за 16 часов без каких-либо усилий — даже если закрыли браузер.

---

### ✦ Почему TurboTX лучше конкурентов

| | TurboTX v14.2 | Конкуренты |
|---|---|---|
| Охват хешрейта | **~88%** | 10–40% |
| Приватный мемпул | ✅ MARA Slipstream | ❌ |
| Работает после закрытия браузера | ✅ Серверные волны | ❌ Только браузер |
| Оплата Lightning Network | ✅ | Редко |
| Smart Advisor (RBF / CPFP) | ✅ | ❌ |
| Пакетное ускорение | ✅ До 20 TX | ❌ |
| API для разработчиков | ✅ 4 тарифа | ❌ |
| Режим anti-stuck (72ч+) | ✅ Агрессивные интервалы | ❌ |
| Open source | ✅ | Обычно ❌ |

---

### ⚡ Ключевые возможности

**🎯 Максимальный охват хешрейта**  
Проприетарный движок рассылки одновременно достигает Foundry, AntPool, MARA, ViaBTC, SpiderPool и 17+ других пулов — ~88% активного хешрейта Bitcoin за одно ускорение.

**🔒 MARA Slipstream**  
Прямая инъекция в приватный мемпул MARA. Транзакция минует публичную очередь и попадает напрямую к майнерам MARA — пула №3 по хешрейту.

**🌊 Персистентная система из 10 волн**  
Premium-транзакции получают до 10 волн повтора за 16 часов. В отличие от конкурентов, у которых "авто-повтор" умирает при закрытии вкладки — волны TurboTX работают на сервере и стреляют по расписанию независимо от того, онлайн ли пользователь.

**🧠 Smart Advisor**  
Перед оплатой TurboTX анализирует транзакцию: текущая комиссия vs сеть, позиция в мемпуле, время зависания, доступность RBF, стоимость CPFP. Вы получаете чёткий план спасения с точными цифрами — не просто кнопку "ускорить".

**⚡ Lightning Network**  
Мгновенные платежи через Lightning с автогенерацией инвойсов и real-time определением оплаты. HMAC-защищённые токены активации — Premium-доступ нельзя перехватить через DevTools браузера.

**📊 Живая аналитика мемпула**  
Двойной сигнал перегрузки: fee rate + размер мемпула. Адаптивные интервалы волн — сокращаются когда комиссии падают, растут когда сеть разгружается. Максимальный шанс подтверждения при минимальной стоимости.

---

### 🔌 Публичное API

Полная документация: [acelerat.vercel.app/api-docs](https://acelerat.vercel.app/api-docs)

```bash
# Анализ застрявшей транзакции
curl "https://acelerat.vercel.app/api/v1?method=status&txid=YOUR_TXID" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY"

# Отправить на ускорение
curl -X POST "https://acelerat.vercel.app/api/v1?method=accelerate" \
  -H "Authorization: Bearer ttx_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txid":"YOUR_TXID","plan":"premium"}'
```

| Метод | Endpoint | Описание |
|---|---|---|
| `GET` | `?method=ping` | Проверка ключа + остаток квоты |
| `GET` | `?method=status&txid=` | Полный анализ TX + план спасения |
| `GET` | `?method=mempool` | Живое состояние сети |
| `GET` | `?method=fees` | Рекомендуемые комиссии |
| `GET` | `?method=price` | Динамическая цена Premium |
| `GET` | `?method=acceleration&txid=` | Решение Smart Advisor |
| `POST` | `?method=accelerate` | Отправить TX на ускорение |
| `POST` | `?method=batch` | Пакетное ускорение (до 20 TX) |
| `GET` | `?method=cpfp&txid=` | CPFP калькулятор |
| `GET` | `?method=rbf&txid=` | RBF калькулятор |
| `GET` | `?method=health` | Состояние сервиса |
| `GET/POST` | `?method=keys` | Управление ключами *(админ)* |

**Тарифные планы:**

| План | Лимиты | Цена |
|---|---|---|
| Free | 30 запр/мин · 500/день | $0 |
| Basic | 100 запр/мин · 5k/день | $29/мес |
| Pro | 500 запр/мин · 50k/день | $99/мес |
| Partner | Без лимитов | Индивидуально |

---

### 📜 История изменений

#### v14.2 — март 2026
- 🌊 Волны теперь работают на сервере — стреляют по расписанию даже без браузера
- 🔄 Автоматическое восстановление состояния волн при возврате на страницу
- 🔧 Фиксы стабильности Lightning-платежей при cold-start
- 🛡 Усиление WebSocket — устранены паразитные reconnect-петли
- 🔥 Улучшена устойчивость к кратковременным сетевым сбоям
- 📈 Улучшены лимиты для высокочастотных Premium-пользователей

#### v14.1 — 2026
- 🔐 HMAC-защита активации — секрет Premium защищён на сервере
- 🐛 Множественные фиксы верификации платежей и движка рассылки
- ⚡ Система волн расширена с 8 до 10 с адаптивными интервалами
- 💡 Приоритет last-block-miner, живой индикатор загрузки мемпула

---

### 🛠 Локальная разработка / Исследование

```bash
# Требует конфигурации — по вопросам деплоя в Telegram
npx vercel dev
```

---

### ⚖️ Лицензия

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange?style=flat-square)](LICENSE)

**Business Source License 1.1** — © 2026 ProjectBarabashka

Исходный код доступен для чтения и личного использования.  
**Коммерческое использование, перепродажа, white-label и конкурирующие сервисы — запрещены.**  
Переходит на MIT-лицензию 01.01.2029.

Коммерческое лицензирование: pollytrazlo@gmail.com · [Telegram](https://t.me/Sup_TurboTX)

---

<div align="center">
  <br/>
  <img src="https://img.shields.io/badge/Built%20for-Bitcoin-f7931a?style=flat-square&logo=bitcoin&logoColor=white"/>
  <img src="https://img.shields.io/badge/Powered%20by-Vercel-000000?style=flat-square&logo=vercel&logoColor=white"/>
  <img src="https://img.shields.io/badge/Node-24.x-339933?style=flat-square&logo=nodedotjs&logoColor=white"/>
  <br/><br/>
  <sub>Made with ⚡ by <a href="https://github.com/ProjectBarabashka">ProjectBarabashka</a> · <a href="https://acelerat.vercel.app">acelerat.vercel.app</a></sub>
</div>
