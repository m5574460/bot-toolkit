"""Python 機器人使用 bot-toolkit 的範例。

做法：Python 只負責「資料 → post.json」，畫圖、做影片、發文都用 subprocess 呼叫 bot-toolkit 的 CLI。
CLI 會從工作目錄（cwd）讀 bot.config.mjs 與 .env，所以這個資料夾裡也放了一個 bot.config.mjs。

執行（需要 Node 22，bot-toolkit 已 npm ci）：
    python make_post.py
"""
import datetime
import json
import pathlib
import subprocess

HERE = pathlib.Path(__file__).parent
CLI = HERE.parent.parent / "src" / "cli.mjs"  # 其他專案：改成 bot-toolkit 資料夾裡的 src/cli.mjs


def toolkit(*args: str) -> None:
    """呼叫 bot-toolkit CLI（在機器人資料夾裡執行）"""
    subprocess.run(["node", str(CLI), *args], cwd=HERE, check=True)


def main() -> None:
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d")  # 台灣日期
    rows = [("0050", "元大台灣50", 1.38), ("0056", "元大高股息", 7.06), ("00878", "國泰永續高股息", 7.09)]

    post = {
        "id": f"{today}-py-demo",
        "brand": {"name": "Python 範例", "site": "https://example.com", "disclaimer": "範例資料，僅供參考。"},
        "slides": [
            {"type": "cover", "kicker": today, "title": "三檔 ETF\n殖利率", "subtitle": "Python 產生的 post.json"},
            {
                "type": "list",
                "header": "殖利率",
                "page": 1,
                "pages": 1,
                "columns": [{"label": "ETF", "width": 640}, {"label": "殖利率", "width": 296, "align": "right"}],
                "rows": [[{"text": code, "sub": name, "weight": 900}, {"text": f"{y}%", "tone": "brand"}] for code, name, y in rows],
            },
            {"type": "cta", "lines": ["完整資料", "到網站查詢"]},
        ],
        "captions": {"threads": {"template": "\n".join(f"・{c} {n} {y}%" for c, n, y in rows)}},
        "narration": [{"slides": [1], "template": "三檔熱門 ETF 的殖利率整理。"}],
    }

    out = HERE / "out" / post["id"]
    out.mkdir(parents=True, exist_ok=True)
    (out / "post.json").write_text(json.dumps(post, ensure_ascii=False, indent=2), encoding="utf-8")

    toolkit("cards", str(out))  # → out/<id>/01.png…
    toolkit("threads", str(out))  # 發文預覽（加 "--confirm" 才會真的發）
    # toolkit("video", str(out), "--tts=edge")  # 做影片


if __name__ == "__main__":
    main()
