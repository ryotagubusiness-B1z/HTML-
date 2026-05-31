#!/bin/bash
# SessionStart hook
# クラウド(web)セッションの開始ごとに Codex CLI を導入・認証する。
# 目的: Claude が「得意分野/同等の作業」を Codex に委譲し、クレジットを節約する。
# 委譲ポリシーは CLAUDE.md の「Codex への委譲」を参照。
set -uo pipefail

# リモート(web)環境でのみ実行。ローカルでは何もしない。
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

log() { echo "[session-start] $*"; }

# 1) Codex CLI を導入（冪等。コンテナキャッシュにより2回目以降は高速）
if command -v codex >/dev/null 2>&1; then
  log "✅ codex 導入済み: $(command -v codex) ($(codex --version 2>/dev/null))"
else
  log "installing @openai/codex ..."
  if npm install -g @openai/codex >/tmp/codex-install.log 2>&1; then
    log "✅ codex 導入完了: $(command -v codex) ($(codex --version 2>/dev/null))"
  else
    log "⚠️ codex の導入に失敗 (/tmp/codex-install.log 参照)。Codex セットアップをスキップします。"
    exit 0
  fi
fi

# 2) API キーがあれば認証（stdin 経由・非対話）
if [ -n "${OPENAI_API_KEY:-}" ]; then
  if printenv OPENAI_API_KEY | codex login --with-api-key >/dev/null 2>&1; then
    log "✅ OPENAI_API_KEY で認証しました ($(codex login status 2>/dev/null | head -1))"
  else
    log "⚠️ 'codex login --with-api-key' に失敗。キー値とネットワークポリシー(api.openai.com)を確認してください。"
  fi
else
  log "⚠️ OPENAI_API_KEY 未設定 — codex は導入済みだが未認証です。"
  log "   Claude Code (web) の環境変数に OPENAI_API_KEY を追加すると、次セッションから委譲が有効になります。"
fi

exit 0
