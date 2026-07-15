#!/usr/bin/env bash
# 下載訓練用的開源字體(全部 SIL Open Font License 1.1)。
#
# 為什麼不用系統字體:macOS 內建字體(Songti/PingFang…)的授權不允許轉散布,
# 雖然「用字體渲染出的圖像」一般沒問題,但要商業化的話,整條產線都用 OFL 字體才乾淨。
# 字體本身不進版控(training/fonts 已 gitignore);跑這支腳本重新取得即可。
#
# 選這三套的理由:涵蓋 明體 / 黑體 / 楷書 三種筆形風格,
# 其中楷書最接近真實象棋棋子上的字。
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fonts
cd fonts

dl() { # url filename
  if [ -f "$2" ]; then echo "  已有 $2"; return; fi
  echo "  下載 $2 …"
  curl -sL "$1" -o "$2"
}

echo "Noto Serif TC(明體,SIL OFL 1.1)"
dl "https://github.com/notofonts/noto-cjk/releases/download/Serif2.003/15_NotoSerifTC.zip" NotoSerifTC.zip
echo "Noto Sans TC(黑體,SIL OFL 1.1)"
dl "https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/19_NotoSansTC.zip" NotoSansTC.zip
echo "霞鶩文楷 LXGW WenKai(楷書,SIL OFL 1.1)"
for w in Regular Light Medium; do
  dl "https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-$w.ttf" "LXGWWenKai-$w.ttf"
done

for z in NotoSerifTC.zip NotoSansTC.zip; do
  [ -f "$z" ] && unzip -qo "$z" && rm -f "$z"
done
# 只留 OTF/TTF/TTC,其餘(授權書除外)清掉
find . -type f ! -name '*.otf' ! -name '*.ttf' ! -name '*.ttc' ! -name 'LICENSE*' ! -name 'OFL*' -delete 2>/dev/null || true
find . -type d -empty -delete 2>/dev/null || true

echo
echo "字體檔:"
find . -type f \( -name '*.otf' -o -name '*.ttf' -o -name '*.ttc' \) | sort
