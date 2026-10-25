#!/usr/bin/env bash
# Публикация проекта на GitHub: создаёт репозиторий и пушит код.
# Использование: GITHUB_TOKEN=ghp_xxx scripts/publish-github.sh [имя-репозитория]
set -euo pipefail

: "${GITHUB_TOKEN:?Установите переменную окружения GITHUB_TOKEN (токен с правами repo)}"
REPO_NAME="${1:-dungeon-arena}"
REPO_DESC="Dungeon Arena — кооп-игра-выживание: волны скелетов и гоблинов, прокачка, мультиплеер"
API="https://api.github.com"

# имя владельца
GITHUB_USER=$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" "${API}/user" \
  | sed -n 's/.*"login": *"\([^"]*\)".*/\1/p' | head -1)
if [ -z "${GITHUB_USER}" ]; then
  echo "Ошибка: не удалось получить имя пользователя — проверьте токен" >&2
  exit 1
fi
echo "GitHub пользователь: ${GITHUB_USER}"

# создать репозиторий (если ещё не существует)
HTTP_CODE=$(curl -s -o /tmp/repo_resp.json -w "%{http_code}" -X POST \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${API}/user/repos" \
  -d "{\"name\":\"${REPO_NAME}\",\"description\":\"${REPO_DESC}\",\"private\":false}")
if [ "${HTTP_CODE}" = "201" ]; then
  echo "Репозиторий ${REPO_NAME} создан"
elif [ "${HTTP_CODE}" = "422" ]; then
  echo "Репозиторий ${REPO_NAME} уже существует — используем его"
else
  echo "Ошибка создания репозитория (HTTP ${HTTP_CODE}):" >&2
  cat /tmp/repo_resp.json >&2
  exit 1
fi

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push -u origin "${BRANCH}"

# убрать токен из remote (безопасность)
git remote set-url origin "https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

echo "Готово: https://github.com/${GITHUB_USER}/${REPO_NAME}"
