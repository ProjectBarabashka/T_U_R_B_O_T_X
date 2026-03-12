# ⚡ TurboTX — Bitcoin Transaction Accelerator

<div align="center">

![TurboTX](https://img.shields.io/badge/TurboTX-v14-f7931a?style=for-the-badge&logo=bitcoin&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=for-the-badge&logo=vercel)
![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Status](https://img.shields.io/badge/Status-Live-00e87a?style=for-the-badge)

**[🚀 Live App](https://acelerat.vercel.app)** • **[📖 API Docs](https://acelerat.vercel.app/api-docs)** • **[💬 Telegram](https://t.me/Sup_TurboTX)**

</div>

---

## 🔥 What is TurboTX?

TurboTX broadcasts stuck Bitcoin transactions to **30 channels** — 8 full nodes + 22 mining pool accelerators — covering **~88% of Bitcoin hashrate**. Includes MARA Slipstream private mempool bypass.

## 📁 Repository Structure

```
T_U_R_B_O_T_X/
├── api/                        # Vercel Serverless Functions
│   ├── v1.js                   # 🆕 Public API v1 (auth + rate limits)
│   ├── keys.js                 # 🆕 API key management
│   ├── router.js               # Unified router (health/status/stats/price/mempool/cpfp/rbf)
│   ├── broadcast.js            # Core TX broadcast engine (v14)
│   ├── acceleration.js         # Smart Advisor — decision engine
│   ├── verify.js               # Payment verification (BTC/USDT/Lightning)
│   ├── repeat.js               # 8-wave repeat broadcast
│   ├── lightning.js            # Lightning Network invoice handler
│   └── telegram.js             # Telegram notifications
│
├── public/                     # Static files (outputDirectory in vercel.json)
│   ├── index.html              # Main SPA (v14, ~7000 lines)
│   ├── client-api.js           # Frontend API client
│   ├── api-docs.html           # 🆕 Public API documentation
│   ├── robots.txt
│   └── sitemap.xml
│
├── .env.example                # Environment variables template
├── package.json                # Node 24.x, ES modules
├── vercel.json                 # Routing, CORS, function config
└── README.md
```

## 🚀 Deploy to Vercel

### 1. Fork & Clone
```bash
git clone https://github.com/ProjectBarabashka/T_U_R_B_O_T_X
cd T_U_R_B_O_T_X
```

### 2. Set Environment Variables
```bash
cp .env.example .env.local
# Fill in your values
```

Required variables in Vercel dashboard:
| Variable | Description |
|---|---|
| `BTC_WALLET` | Bitcoin receiving address |
| `USDT_WALLET` | USDT TRC-20 address |
| `TG_TOKEN` | Telegram bot token |
| `TG_CHAT_ID` | Telegram notification chat ID |
| `PREMIUM_SECRET` | Payment verification secret |
| `ADMIN_SECRET` | Admin API access secret |

### 3. Deploy
```bash
npx vercel --prod
```

Or connect repo to [vercel.com](https://vercel.com) for automatic deploys on push.

## 🔌 Public API

Full documentation at **[acelerat.vercel.app/api-docs](https://acelerat.vercel.app/api-docs)**

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

### API Endpoints
| Method | Endpoint | Description |
|---|---|---|
| GET | `?method=ping` | Verify key + rate limits |
| GET | `?method=status&txid=` | Full TX analysis |
| GET | `?method=mempool` | Network state |
| GET | `?method=fees` | Recommended fee rates |
| GET | `?method=price` | Dynamic pricing |
| GET | `?method=acceleration&txid=` | Smart advisor |
| POST | `?method=accelerate` | Submit TX for boost |
| GET | `?method=cpfp&txid=` | CPFP calculator |
| GET | `?method=rbf&txid=` | RBF calculator |
| GET | `?method=health` | Service health |

### API Tiers
| Tier | Rate Limit | Price |
|---|---|---|
| Free | 30 req/min · 500/day | $0 |
| Basic | 100 req/min · 5k/day | $29/mo |
| Pro | 500 req/min · 50k/day | $99/mo |
| Partner | Unlimited | Custom |

## ⚡ Key Features

- **~88% Hashrate Coverage** — Foundry, AntPool, MARA, ViaBTC, SpiderPool + 17 more
- **MARA Slipstream** — Private mempool bypass
- **Smart Advisor** — Decision engine with cost analysis, time forecast, rescue plan
- **8-Wave Broadcast** — Adaptive intervals, anti-stuck mode
- **Lightning Payments** — Invoice generation + verification
- **Dynamic Pricing** — Based on real-time mempool + fee signals
- **Multi-language** — Auto-translation to any language

## 🛠 Local Development

```bash
npm install -g vercel
vercel dev
# → http://localhost:3000
```

## ⚖️ License

`PROPRIETARY` — © 2026 ProjectBarabashka

For licensing inquiries: pollytrazlo@gmail.com

---

<div align="center">
  <sub>Built with ⚡ by <a href="https://github.com/ProjectBarabashka">ProjectBarabashka</a> · <a href="https://acelerat.vercel.app">acelerat.vercel.app</a></sub>
</div>
