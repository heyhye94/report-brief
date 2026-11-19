#!/bin/zsh
# Anthropic API 키를 화면에 표시하지 않고 입력받아 .env 에 저장
cd "$(dirname "$0")/.." || exit 1
printf "Anthropic API 키를 붙여넣고 Enter (입력 내용은 보이지 않아요): "
read -rs key
echo
if [[ -z "$key" ]]; then echo "입력이 비어 있어 저장하지 않았어요."; exit 1; fi
echo "ANTHROPIC_API_KEY=$key" > .env
chmod 600 .env
unset key
echo "저장 완료: $(pwd)/.env"
