# 💻 RENTOP.KG — Web Platform for Laptop Rentals & Sales

[![Tech Stack](https://img.shields.io/badge/Stack-JavaScript%20%7C%20Supabase%20%7C%20Telegram%20API-blue)](#tech-stack)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)](#)

**RENTOP.KG** — это современная веб-платформа для бизнеса по покупке, продаже и сдаче в аренду ноутбуков в городе Бишкек. Проект включает каталогизацию с реальной облачной базой данных, фильтрацию устройств в реальном времени и автоматическую отправку заявок через Telegram Bot API.

---

## 🚀 Основные возможности (Features)

- **Интерактивный каталог ноутбуков**: Отображение актуального парка техники с фильтрацией по категориям (*Аренда*, *Продажа / Предзаказ*).
- **Поиск в реальном времени**: Фильтрация лотов по названию, процессору и характеристикам.
- **Облачная база данных (Supabase PostgreSQL)**: Хранение и динамическая подгрузка каталога с настроенным RLS (Row Level Security).
- **Интеграция с Telegram Bot API**: Моментальная отправка заявок клиентов с деталями заказа напрямую менеджеру в Telegram.
- **Адаптивный дизайн**: Оптимизирован под мобильные устройства, планшеты и ПК.

---

## 🛠 Технологический стек (Tech Stack)

- **Frontend**: HTML5, CSS3, JavaScript (ES6+ Modules)
- **Backend / Database**: Supabase (PostgreSQL, Row Level Security, Storage)
- **Notifications**: Telegram Bot API
- **CDN**: Supabase JS SDK v2

---

## 📁 Структура проекта (Project Structure)

```text
rentop-kg/
├── index.html         # Главная страница приложения
├── css/
│   └── style.css      # Стили и адаптивная верстка
├── js/
│   ├── app.js         # Основная логика приложения и фильтрация
│   ├── config.js      # Конфигурационные ключи API
│   └── supabase.js    # Подключение и работа с БД Supabase
├── .gitignore         # Игнорируемые файлы Git
└── README.md          # Документация проекта
```

---

## ⚙️ Установка и запуск локально (Local Setup)

1. **Клонируйте репозиторий:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/rentop-kg.git
   cd rentop-kg
   ```

2. **Настройте ключи доступа в `js/config.js`:**
   ```javascript
   export const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
   export const TELEGRAM_CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID';
   export const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
   export const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
   ```

3. **Запустите локальный сервер** (например, через расширение *Live Server* в VS Code).

---

© 2026 RENTOP.KG — Ноутбуки в аренду и на продажу в Бишкеке.
