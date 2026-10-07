# BreezyVoice（台灣口音 TTS）本機設定

影片配音用聯發科 [BreezyVoice](https://github.com/mtkresearch/BreezyVoice)（Apache-2.0），
以 Docker + GPU 跑在本機，`bot-toolkit video` 時自動啟動、做完自動關閉（`src/tts/index.mjs` 的 prepareTts）。

## 安裝

```bash
cd ..                                  # 與本專案同層
git clone https://github.com/mtkresearch/BreezyVoice.git
cd BreezyVoice
git checkout d592c9d3e8927a0f53f68616387060dcd32a05ea
git apply --ignore-whitespace ../bot-toolkit/tools/breezyvoice/breezyvoice-local.patch   # 原始碼是 CRLF，patch 是 LF
cp ../bot-toolkit/tools/breezyvoice/compose.gpu.yaml .
mkdir voices                           # 參考錄音放這裡（見下方）
docker compose build                   # 約 12 GB，第一次很久
```

需求：Docker Desktop 4.4x 以上（舊版 26.0 在新 NVIDIA 驅動下 WSL 內 CUDA 會失敗：`Error 500: named symbol not found`）。

## patch 修了什麼

| 檔案 | 原因 |
|---|---|
| Dockerfile | 建置用 `setuptools<70`（`openai-whisper` 需要 `pkg_resources`）；`transformers>=4.40` 避免編譯 `tokenizers`；`ruamel.yaml<0.18`（HyperPyYAML 相容）；執行環境也要 `setuptools<70`；改用 CPU 版 `onnxruntime`（GPU 版在 WSL 初始化失敗，且 CPU/GPU 兩版互相覆蓋檔案） |
| single_inference.py | `torch.set_num_threads(1)` 改成讀 `TORCH_THREADS` |
| cosyvoice/cli/frontend.py | onnxruntime 執行緒讀 `ORT_THREADS`；參考錄音特徵只算一次（原本每句重算，佔一半時間） |
| api.py | 參考錄音逐字稿的注音轉換只做一次 |

## 換參考錄音（聲音）

BreezyVoice 會模仿參考錄音的音色與語氣。在 BreezyVoice 資料夾建立 `.env`：

```
SPEAKER_PROMPT_AUDIO_PATH=./voices/<檔名>.wav
SPEAKER_PROMPT_TEXT_TRANSCRIPTION=<錄音的逐字稿，一字不差>
```

- 目前用 Edge YunJhe 念的 8 秒片段（逐字稿見 `yunjhe-short.txt`）
- 參考錄音越長，每句生成越慢；6～10 秒、安靜環境、語氣就是你想要的語氣
- 換成真人錄音時，記得取得當事人同意（長期商用）

## 效能（RTX 3070 Ti Laptop、WSL 7.6 GB）

每句約 30～60 秒。主要瓶頸是 WSL 記憶體（容器吃 5.3 GB），可在 `%USERPROFILE%\.wslconfig` 調高：

```
[wsl2]
memory=12GB
```

`compose.cpu.yaml` 是沒有 GPU 時的備案（每句 15～20 分鐘，只適合試聽）。
