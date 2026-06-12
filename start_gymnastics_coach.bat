@echo off
title 國民健康操 AI 教練啟動器
cd /d "C:\Users\Administrator\.gemini\antigravity\scratch\gymnastic-exercise-ai-coach-full"

echo ===================================================
echo   民國七十年代第一國民健康操 AI 教練 快速啟動器
echo ===================================================
echo.
echo 1. 正在開啟瀏覽器測試頁面 (https://localhost:8000)...
start https://localhost:8000

echo 2. 正在啟動後端 FastAPI 伺服器...
echo [提示] 欲關閉伺服器，請直接關閉此命令提示字元視窗。
echo ---------------------------------------------------
venv\Scripts\python.exe main.py

pause
