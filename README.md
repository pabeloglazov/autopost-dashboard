# Autopost — панель и аналитика

Автопостинг новостей Павла Белоглазова: Instagram Stories (@pabeloglazov, @pabeloglazov_injury) и Threads (@pabeloglazov), плюс лейбл ФЬЮЧЕ: Instagram @futurepeoplemusic и Threads ФЬЮЧЕ (токены TOKEN_FUTURE и TOKEN_THREADS_FUTURE, своя очередь Threads, своя аналитика `insights_summary` со `scope: "future"`, темы с `dir: "FUT"`), плюс аналитика охватов.

- `index.html` — панель (GitHub Pages). Данные читает у скрипта Google Apps Script по ключу панели (READ_KEY из Script Properties), сам ключ в коде не хранится.
- `apps-script/Code.gs` — копия кода скрипта «IG Autopost». Токены и ключи лежат только в Script Properties.

## Как работает
1. Каждое утро задача Claude собирает 15 новостей по иммиграции и 15 по Personal Injury, верстает сторис и публикует в оба Instagram-аккаунта; те же новости уходят в очередь Threads.
2. Днём задача по трендам Threads пишет 20 постов и ставит их в очередь. Скрипт публикует очередь равномерно до 22:00.
3. Каждый час скрипт собирает статистику (охват сторис за первые 24 часа, просмотры и реакции Threads за 7 дней).
4. Перед каждым запуском задачи читают сводку `insights_summary` и смещают темы и форматы к тому, что собирает больше охвата (примерно 2/3 проверенного, 1/3 экспериментов).
5. Threads ФЬЮЧЕ: задача ставит в очередь 15 или 20 постов (чередуя по дням), а перед этим вызывает `threads_prune` — скрипт удаляет вчерашние посты ФЬЮЧЕ без единого ответа. Записи в analytics.json остаются с пометкой `deleted_at`, так что статистика и журнал выводов учитывают и удалённые посты. Нужен scope `threads_delete` у токена TOKEN_THREADS_FUTURE.
