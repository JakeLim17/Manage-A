#!/bin/zsh -l
cd -- "${0:A:h}"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Node.js 24를 설치한 뒤 다시 실행해 주세요.'
  read '?Enter를 누르면 닫습니다.'
  exit 1
fi
if curl --silent --fail http://127.0.0.1:4310/api/session >/dev/null; then
  open http://127.0.0.1:4310
  exit 0
fi
echo 'Manage-A: http://127.0.0.1:4310'
echo '이 터미널을 닫으면 대시보드가 종료됩니다.'
(sleep 2; open http://127.0.0.1:4310) &
npm start
